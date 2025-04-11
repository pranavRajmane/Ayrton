#!/usr/bin/env python3
"""
OpenFOAM Casting Simulation Runner
This script automates the workflow for OpenFOAM casting simulations:
1. Reads configuration from YAML file
2. Calculates optimal simulation parameters
3. Modifies OpenFOAM dictionaries
4. Runs the simulation

Modified to allow for short test runs (1 second)
"""

import os
import sys
import yaml
import math
import time
import shutil
import subprocess
import re
import json
from datetime import datetime

class CastingSimulationRunner:
    def __init__(self, yaml_file, base_case_dir="sandCastingBase", test_mode=False):
        """Initialize the casting simulation with config file and base case directory"""
        self.yaml_file = yaml_file
        self.base_case_dir = base_case_dir
        self.sim_case_dir = f"casting_simulation_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.config = None
        self.mesh_volume = None
        self.calculated_fill_time = None
        self.results = {}
        self.test_mode = test_mode  # Flag for running in test mode (1 second)
        
        # Load configuration
        self.load_config()
        
    def load_config(self):
        """Load YAML configuration file"""
        try:
            with open(self.yaml_file, 'r') as file:
                self.config = yaml.safe_load(file)
                print(f"Configuration loaded from {self.yaml_file}")
        except Exception as e:
            print(f"Error loading configuration: {e}")
            sys.exit(1)
    
    def prepare_case_directory(self):
        """Create a new case directory by copying the base case"""
        try:
            # Copy base case to new simulation directory
            shutil.copytree(self.base_case_dir, self.sim_case_dir)
            print(f"Prepared case directory: {self.sim_case_dir}")
            return True
        except Exception as e:
            print(f"Error preparing case directory: {e}")
            return False
    
    def calculate_mesh_volume(self):
        """Calculate the volume of the fluid mesh using checkMesh"""
        try:
            # Change to simulation directory
            original_dir = os.getcwd()
            os.chdir(self.sim_case_dir)
            
            # Run checkMesh and capture output
            result = subprocess.run(["checkMesh", "-latestTime"], 
                                   capture_output=True, text=True, check=True)
            
            # Extract volume information using regex
            volume_match = re.search(r"Cell volumes\s+:\s+min\s+=\s+[\d\.e-]+\s+max\s+=\s+[\d\.e-]+\s+average\s+=\s+[\d\.e-]+\s+total\s+=\s+([\d\.e-]+)", 
                                    result.stdout)
            
            if volume_match:
                self.mesh_volume = float(volume_match.group(1))
                print(f"Mesh volume calculated: {self.mesh_volume} m³")
            else:
                # Use cavity volume from YAML if available
                self.mesh_volume = self.config['casting'].get('cavity_volume', 0.002)
                print(f"Could not extract mesh volume, using value from config: {self.mesh_volume} m³")
            
            # Return to original directory
            os.chdir(original_dir)
            return self.mesh_volume
            
        except Exception as e:
            print(f"Error calculating mesh volume: {e}")
            os.chdir(original_dir)
            # Use cavity volume from YAML if available
            self.mesh_volume = self.config['casting'].get('cavity_volume', 0.002)
            print(f"Using volume from config: {self.mesh_volume} m³")
            return self.mesh_volume
    
    def calculate_simulation_parameters(self):
        """Calculate optimal simulation parameters based on mesh volume and material properties"""
        # Get mass flow rate
        mass_flowrate = self.config['casting']['target_mass_flowrate']
        
        # Calculate mass of metal to fill the cavity
        density = self.config['material']['density']
        mass = self.mesh_volume * density
        
        # Calculate fill time
        self.calculated_fill_time = mass / mass_flowrate
        
        # Calculate Reynolds number to evaluate turbulence
        # Get inlet diameter if specified, otherwise estimate
        inlet_diameter = self.config['casting'].get('inlet_diameter', 0.02)  # default 20mm
        inlet_area = math.pi * (inlet_diameter/2)**2
        
        # Calculate velocity
        volume_flow_rate = mass_flowrate / density
        velocity = volume_flow_rate / inlet_area
        
        # Use inlet diameter as characteristic length for Reynolds calculation
        characteristic_length = inlet_diameter
        viscosity = self.config['material']['viscosity']
        
        reynolds = (density * velocity * characteristic_length) / viscosity
        
        # Store calculations in results
        self.results['cavity_volume'] = self.mesh_volume
        self.results['metal_mass'] = mass
        self.results['fill_time'] = self.calculated_fill_time
        self.results['reynolds_number'] = reynolds
        self.results['characteristic_length'] = characteristic_length
        self.results['inlet_velocity'] = velocity
        self.results['inlet_diameter'] = inlet_diameter
        self.results['inlet_area'] = inlet_area
        
        # Set simulation end time to fill time plus cooling time
        cooling_time = self.config['simulation']['post_filling_cooling_time']
        simulation_end_time = self.calculated_fill_time + cooling_time
        
        print(f"Calculated fill time: {self.calculated_fill_time:.2f} seconds")
        
        # If in test mode, override end time to 1 second
        if self.test_mode:
            simulation_end_time = 1.0
            print(f"TEST MODE: Overriding simulation end time to {simulation_end_time} second")
        else:
            print(f"Simulation end time: {simulation_end_time:.2f} seconds")
        
        print(f"Estimated Reynolds number: {reynolds:.2f}")
        
        # Check if Reynolds number indicates excessive turbulence
        max_reynolds = self.config['casting']['max_acceptable_reynolds']
        if reynolds > max_reynolds and not self.test_mode:  # Skip Reynolds check in test mode
            print(f"WARNING: Reynolds number ({reynolds:.2f}) exceeds maximum acceptable value ({max_reynolds})")
            print("Simulation may show excessive turbulence. Consider reducing mass flow rate.")
            
            # Ask user if they want to continue
            answer = input("Do you want to continue with the simulation despite high Reynolds number? (yes/no): ")
            if answer.lower() != 'yes':
                print("Simulation aborted by user.")
                sys.exit(0)
        
        return simulation_end_time
    
    def modify_openfoam_files(self, end_time):
        """Modify OpenFOAM dictionary files with the calculated parameters"""
        try:
            # Change to simulation directory
            original_dir = os.getcwd()
            os.chdir(self.sim_case_dir)
            
            # 1. Modify controlDict
            self.modify_control_dict(end_time)
            
            # 2. Modify fvModels (for mass flow rate)
            self.modify_fv_models()
            
            # 3. Modify temperature fields
            self.modify_temperature_fields()
            
            # 4. Modify physical properties
            self.modify_physical_properties()
            
            # Return to original directory
            os.chdir(original_dir)
            return True
            
        except Exception as e:
            print(f"Error modifying OpenFOAM files: {e}")
            os.chdir(original_dir)
            return False
    
    def modify_control_dict(self, end_time):
        """Modify the system/controlDict file"""
        control_dict_path = "system/controlDict"
        
        # Read the existing file
        with open(control_dict_path, 'r') as file:
            content = file.readlines()
        
        # Modify the content
        for i, line in enumerate(content):
            if "endTime" in line and ";" in line:
                content[i] = f"endTime         {end_time};\n"
            elif "writeInterval" in line and ";" in line:
                # For test mode, write more frequently
                if self.test_mode and end_time == 1.0:
                    content[i] = f"writeInterval   0.1;\n"  # Write 10 times during the 1-second run
                else:
                    content[i] = f"writeInterval   {self.config['simulation']['write_interval']};\n"
            elif "maxCo" in line and ";" in line:
                content[i] = f"maxCo           {self.config['simulation']['max_courant_number']};\n"
        
        # Write the modified content back
        with open(control_dict_path, 'w') as file:
            file.writelines(content)
        
        print(f"Modified {control_dict_path}")
    
    def modify_fv_models(self):
        """Modify the constant/fvModels file for mass flow rate"""
        fv_models_path = "constant/fvModels"
        
        # Read the existing file
        with open(fv_models_path, 'r') as file:
            content = file.readlines()
        
        # Modify the content
        for i, line in enumerate(content):
            if "massFlowRate" in line and ";" in line:
                content[i] = f"    massFlowRate {self.config['casting']['target_mass_flowrate']};\n"
        
        # Write the modified content back
        with open(fv_models_path, 'w') as file:
            file.writelines(content)
        
        print(f"Modified {fv_models_path}")
    
    def modify_temperature_fields(self):
        """Modify the 0/T files for temperature initialization"""
        # Modify T.metal
        t_metal_path = "0/T.metal"
        pouring_temp_k = self.config['casting']['pouring_temperature'] + 273.15  # Convert to Kelvin
        
        if os.path.exists(t_metal_path):
            with open(t_metal_path, 'r') as file:
                content = file.readlines()
            
            for i, line in enumerate(content):
                if "internalField" in line and "uniform" in line:
                    content[i] = f"internalField   uniform {pouring_temp_k};\n"
                
                # Also update source temperature if it exists
                if "uniformValue" in line and ";" in line and "sources" in ''.join(content[max(0, i-10):i]):
                    content[i] = f"        uniformValue    {pouring_temp_k};\n"
            
            with open(t_metal_path, 'w') as file:
                file.writelines(content)
            
            print(f"Modified {t_metal_path}")
        
        # Modify general T field
        t_path = "0/T"
        if os.path.exists(t_path):
            with open(t_path, 'r') as file:
                content = file.readlines()
            
            for i, line in enumerate(content):
                # Update source temperature if it exists
                if "uniformValue" in line and ";" in line and "sources" in ''.join(content[max(0, i-10):i]):
                    content[i] = f"        uniformValue    {pouring_temp_k};\n"
            
            with open(t_path, 'w') as file:
                file.writelines(content)
            
            print(f"Modified {t_path}")
    
    def modify_physical_properties(self):
        """Modify the physical properties files with values from YAML"""
        # Modify metal properties
        metal_props_path = "constant/physicalProperties.metal"

        if os.path.exists(metal_props_path):
            print(f"Found existing {metal_props_path}, updating values")

            # Read the file line by line
            with open(metal_props_path, 'r') as f:
                lines = f.readlines()

            in_thermoType = False
            in_mixture = False
            in_equationOfState = False
            in_thermodynamics = False
            in_transport = False
        
            # Process each line
            for i, line in enumerate(lines):
                # Track which block we're in
                if "thermoType" in line:
                    in_thermoType = True
                    in_mixture = False
                elif "mixture" in line:
                    in_thermoType = False
                    in_mixture = True
            
                # Inside mixture block, track sub-blocks
                if in_mixture:
                    if "equationOfState" in line and "{" in line:
                        in_equationOfState = True
                        in_thermodynamics = False
                        in_transport = False
                    elif "thermodynamics" in line and "{" in line:
                        in_equationOfState = False
                        in_thermodynamics = True
                        in_transport = False
                    elif "transport" in line and "{" in line:
                        in_equationOfState = False
                        in_thermodynamics = False
                        in_transport = True
                    elif "}" in line:
                        # Check if this is closing a sub-block
                        if in_equationOfState or in_thermodynamics or in_transport:
                            in_equationOfState = False
                            in_thermodynamics = False
                            in_transport = False
                        # Check if this is closing the mixture block
                        elif line.strip() == "}":
                            in_mixture = False
            
                # Only modify inside mixture block, not in thermoType block
                if in_mixture:
                    if in_equationOfState and "rho" in line and ";" in line:
                        # Extract indentation
                        indent = line[:line.find("rho")]
                        lines[i] = f"{indent}rho         {self.config['material']['density']};\n"
                
                    elif in_thermodynamics and "Cp" in line and ";" in line:
                        # Extract indentation
                        indent = line[:line.find("Cp")]
                        lines[i] = f"{indent}Cp          {self.config['material']['specific_heat']};\n"
                
                    elif in_transport and "mu" in line and ";" in line:
                        # Extract indentation
                        indent = line[:line.find("mu")]
                        lines[i] = f"{indent}mu          {self.config['material']['viscosity']};\n"

            # Write the modified content back
            with open(metal_props_path, 'w') as f:
                f.writelines(lines)

            print(f"Updated values in {metal_props_path}")
        else:
            # Handle case where file doesn't exist
            print(f"WARNING: Could not find {metal_props_path}")
            print("The simulation may proceed with default values")

        # Modify surface tension in phaseProperties if it exists (unchanged)
        phase_props_path = "constant/phaseProperties"
        if os.path.exists(phase_props_path):
            with open(phase_props_path, 'r') as f:
                lines = f.readlines()
        
            # Update surface tension
            for i, line in enumerate(lines):
                if "sigma" in line and ";" in line:
                    # Extract indentation
                    indent = line[:line.find("sigma")]
                    lines[i] = f"{indent}sigma {self.config['material']['surface_tension']};\n"
        
            with open(phase_props_path, 'w') as f:
                f.writelines(lines)
        
            print(f"Updated surface tension in {phase_props_path}")
            
    def run_simulation(self):
        """Run the OpenFOAM simulation using the Allrun script"""
        try:
            # Change to simulation directory
            original_dir = os.getcwd()
            os.chdir(self.sim_case_dir)
            
            # Make the Allrun script executable
            os.chmod("Allrun", 0o755)
            
            print("Starting OpenFOAM simulation...")
            if self.test_mode:
                print("TEST MODE: Running for 1 second only")
                
            # Run the Allrun script
            subprocess.run(["./Allrun"], check=True)
            
            print("Simulation completed successfully")
            self.results['simulation_status'] = "Completed"
            if self.test_mode:
                self.results['simulation_mode'] = "Test (1 second)"
            
            # Return to original directory
            os.chdir(original_dir)
            return True
            
        except Exception as e:
            print(f"Error running simulation: {e}")
            self.results['simulation_status'] = f"Failed: {str(e)}"
            os.chdir(original_dir)
            return False
    
    def save_results(self):
        """Save simulation parameters and results to a JSON file for the analyzer"""
        results_file = f"{self.sim_case_dir}_results.json"
        try:
            with open(results_file, 'w') as f:
                json.dump(self.results, f, indent=4)
            print(f"Saved simulation results to {results_file}")
            return results_file
        except Exception as e:
            print(f"Error saving results: {e}")
            return None
            
    def run_workflow(self):
        """Run the casting simulation workflow"""
        print("=== OpenFOAM Casting Simulation Workflow ===")
        if self.test_mode:
            print("RUNNING IN TEST MODE: Simulation will run for 1 second only")
        
        # Step 1: Calculate mesh volume
        print("\nStep 1: Preparing case directory and analyzing mesh...")
        if not self.prepare_case_directory():
            print("Failed to prepare case directory. Aborting.")
            return False
        
        self.calculate_mesh_volume()
        
        # Step 2: Calculate simulation parameters
        print("\nStep 2: Calculating simulation parameters...")
        end_time = self.calculate_simulation_parameters()
        
        # Pre-simulation quality check - skip detailed checks in test mode
        if self.results.get('reynolds_number', 0) > self.config['casting']['max_acceptable_reynolds'] and not self.test_mode:
            print("\nWARNING: Pre-simulation analysis indicates potential quality issues.")
            print("Consider revising the mass flow rate or gating design before proceeding.")
        
        # Step 3: Modify OpenFOAM files
        print("\nStep 3: Modifying OpenFOAM configuration files...")
        if not self.modify_openfoam_files(end_time):
            print("Failed to modify OpenFOAM files. Aborting.")
            return False
        
        # Step 4: Run simulation
        print("\nStep 4: Running OpenFOAM simulation...")
        if not self.run_simulation():
            print("Simulation failed to complete successfully.")
            
        # Save simulation results
        results_file = self.save_results()
        
        # Save config for analyzer
        config_copy = f"{self.sim_case_dir}_config.yaml"
        shutil.copy(self.yaml_file, config_copy)
        
        print("\n=== Simulation Workflow Completed ===")
        print(f"Simulation directory: {self.sim_case_dir}")
        print(f"Results file: {results_file}")
        print(f"Config file: {config_copy}")
        
        return self.sim_case_dir, results_file, config_copy


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python run_simulation.py <yaml_file> [base_case_dir] [--test]")
        print("Example: python run_simulation.py aluminum.yaml sandCastingBase --test")
        sys.exit(1)
    
    # Parse command line arguments
    yaml_file = sys.argv[1]
    
    # Check for test mode flag
    test_mode = "--test" in sys.argv
    if test_mode:
        # Remove test flag from arguments to avoid confusion with base_case_dir
        sys.argv.remove("--test")
    
    # Get base case directory if provided
    base_case_dir = sys.argv[2] if len(sys.argv) > 2 else "sandCastingBase"
    
    runner = CastingSimulationRunner(yaml_file, base_case_dir, test_mode)
    sim_dir, results_file, config_file = runner.run_workflow()
    
    print(f"To analyze the results, run: python analyzer.py {sim_dir} {results_file} {config_file}")