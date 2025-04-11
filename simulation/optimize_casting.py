#!/usr/bin/env python3
"""
OpenFOAM Casting Simulation Runner and Analyzer
This script automates the workflow for OpenFOAM casting simulations:
1. Reads configuration from YAML file
2. Calculates optimal simulation parameters
3. Modifies OpenFOAM dictionaries
4. Runs the simulation
5. Analyzes results for quality assessment
6. Generates a PDF report
"""

import os
import sys
import yaml
import math
import time
import shutil
import numpy as np
import subprocess
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from datetime import datetime
import re
import glob

class CastingSimulation:
    def __init__(self, yaml_file, base_case_dir="sandCastingBase"):
        """Initialize the casting simulation with config file and base case directory"""
        self.yaml_file = yaml_file
        self.base_case_dir = base_case_dir
        self.sim_case_dir = f"casting_simulation_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.config = None
        self.mesh_volume = None
        self.calculated_fill_time = None
        self.results = {}
        
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
        print(f"Simulation end time: {simulation_end_time:.2f} seconds")
        print(f"Estimated Reynolds number: {reynolds:.2f}")
        
        # Check if Reynolds number indicates excessive turbulence
        max_reynolds = self.config['casting']['max_acceptable_reynolds']
        if reynolds > max_reynolds:
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
            # Run the Allrun script
            subprocess.run(["./Allrun"], check=True)
            
            print("Simulation completed successfully")
            self.results['simulation_status'] = "Completed"
            
            # Return to original directory
            os.chdir(original_dir)
            return True
            
        except Exception as e:
            print(f"Error running simulation: {e}")
            self.results['simulation_status'] = f"Failed: {str(e)}"
            os.chdir(original_dir)
            return False
    
    def analyze_results(self):
        """Analyze the simulation results for quality assessment"""
        try:
            # Change to simulation directory
            original_dir = os.getcwd()
            os.chdir(self.sim_case_dir)
            
            print("Analyzing simulation results...")
            
            # Find the latest time directory
            time_dirs = glob.glob("[0-9]*.[0-9]*")
            time_dirs = [d for d in time_dirs if os.path.isdir(d)]
            if not time_dirs:
                raise Exception("No time directories found")
            
            # Sort time directories numerically
            time_dirs.sort(key=float)
            latest_time = time_dirs[-1]
            fill_time_dir = None
            
            # Find time directory closest to calculated fill time
            for time_dir in time_dirs:
                if float(time_dir) >= self.calculated_fill_time:
                    fill_time_dir = time_dir
                    break
            
            if not fill_time_dir:
                fill_time_dir = latest_time
            
            print(f"Using time directory {fill_time_dir} for fill analysis")
            
            # Check fill status at calculated fill time
            self.analyze_fill_status(fill_time_dir)
            
            # Check temperature distribution
            self.analyze_temperature(fill_time_dir)
            
            # Check velocity and turbulence
            self.analyze_flow(fill_time_dir)
            
            # Return to original directory
            os.chdir(original_dir)
            
            # Final quality assessment
            self.quality_assessment()
            
            return True
            
        except Exception as e:
            print(f"Error analyzing results: {e}")
            os.chdir(original_dir)
            return False
    
    def analyze_fill_status(self, time_dir):
        """Analyze the filling status at the given time"""
        # Check alpha.metal file for fill status
        alpha_file = f"{time_dir}/alpha.metal"
        
        if os.path.exists(alpha_file):
            # Use foamDictionary to extract internal field
            try:
                result = subprocess.run(["foamDictionary", "-entry", "internalField", alpha_file], 
                                      capture_output=True, text=True, check=True)
                
                # Check if it's a uniform field
                if "uniform" in result.stdout:
                    alpha_value = float(result.stdout.split("uniform")[1].strip().rstrip(';'))
                    self.results['fill_status'] = {
                        'uniform': True,
                        'value': alpha_value,
                        'unfilled_percentage': 1.0 - alpha_value
                    }
                    print(f"Uniform fill status: {alpha_value * 100:.2f}% filled")
                else:
                    # Need to use sample utility to analyze non-uniform field
                    print("Non-uniform fill field detected - advanced analysis required")
                    # This would require running sampling utilities and is more complex
                    
                    # Simplified approach - get a general fill status estimate
                    # Run postProcess with -func "mag(alpha.metal)"
                    subprocess.run(["postProcess", "-time", time_dir, "-func", "mag(alpha.metal)"], 
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    
                    # Check if avg folder was created
                    if os.path.exists(f"{time_dir}/uniform/alpha.metalMag"):
                        with open(f"{time_dir}/uniform/alpha.metalMag", 'r') as file:
                            avg_content = file.read()
                            # Extract average value
                            avg_match = re.search(r"([0-9]+\.[0-9]+e?[-+]?[0-9]*)", avg_content)
                            if avg_match:
                                avg_fill = float(avg_match.group(1))
                                self.results['fill_status'] = {
                                    'uniform': False,
                                    'average_value': avg_fill,
                                    'unfilled_percentage': 1.0 - avg_fill
                                }
                                print(f"Average fill status: {avg_fill * 100:.2f}% filled")
            except Exception as e:
                print(f"Error analyzing fill status: {e}")
                self.results['fill_status'] = {
                    'error': str(e)
                }
    
    def analyze_temperature(self, time_dir):
        """Analyze the temperature distribution at the given time"""
        # Check T.metal file for temperature distribution
        temp_file = f"{time_dir}/T.metal"
        if not os.path.exists(temp_file):
            temp_file = f"{time_dir}/T"
        
        if os.path.exists(temp_file):
            try:
                # Use foamDictionary to extract internal field info
                result = subprocess.run(["foamDictionary", "-entry", "internalField", temp_file], 
                                      capture_output=True, text=True, check=True)
                
                # Check if it's a uniform field
                if "uniform" in result.stdout:
                    temp_value = float(result.stdout.split("uniform")[1].strip().rstrip(';'))
                    self.results['temperature'] = {
                        'uniform': True,
                        'value': temp_value - 273.15  # Convert to Celsius
                    }
                    print(f"Uniform temperature: {temp_value - 273.15:.2f}°C")
                else:
                    # For non-uniform field, run postProcess with field min/max
                    subprocess.run(["postProcess", "-time", time_dir, "-func", "minMaxMag(T)"], 
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    
                    # Check if field min/max file was created
                    if os.path.exists(f"{time_dir}/fieldMinMax"):
                        with open(f"{time_dir}/fieldMinMax/minMaxMag(T)", 'r') as file:
                            content = file.read()
                            # Extract min and max values
                            min_match = re.search(r"min\s*=\s*([0-9]+\.[0-9]+e?[-+]?[0-9]*)", content)
                            max_match = re.search(r"max\s*=\s*([0-9]+\.[0-9]+e?[-+]?[0-9]*)", content)
                            
                            if min_match and max_match:
                                min_temp = float(min_match.group(1)) - 273.15  # Convert to Celsius
                                max_temp = float(max_match.group(1)) - 273.15  # Convert to Celsius
                                
                                self.results['temperature'] = {
                                    'uniform': False,
                                    'min': min_temp,
                                    'max': max_temp
                                }
                                print(f"Temperature range: {min_temp:.2f}°C to {max_temp:.2f}°C")
                                
                                # Check if minimum temperature is below critical threshold
                                min_acceptable = self.config['quality_checks']['min_front_temperature']
                                if min_temp < min_acceptable:
                                    print(f"WARNING: Minimum temperature ({min_temp:.2f}°C) is below critical threshold ({min_acceptable}°C)")
                                    print("Risk of cold shuts or incomplete filling")
            except Exception as e:
                print(f"Error analyzing temperature: {e}")
                self.results['temperature'] = {
                    'error': str(e)
                }
    
    def analyze_flow(self, time_dir):
        """Analyze the flow velocity and turbulence at the given time"""
        # Check velocity (U) file
        u_file = f"{time_dir}/U"
        
        if os.path.exists(u_file):
            try:
                # Run postProcess with magU to get velocity magnitude
                subprocess.run(["postProcess", "-time", time_dir, "-func", "mag(U)"], 
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                
                # Check if field min/max file was created
                if os.path.exists(f"{time_dir}/uniform/UMag"):
                    with open(f"{time_dir}/uniform/UMag", 'r') as file:
                        content = file.read()
                        # Extract average, min and max values
                        avg_match = re.search(r"([0-9]+\.[0-9]+e?[-+]?[0-9]*)", content)
                        
                        if avg_match:
                            avg_velocity = float(avg_match.group(1))
                            
                            # Run postProcess with minMaxMag to get min/max
                            subprocess.run(["postProcess", "-time", time_dir, "-func", "minMaxMag(U)"], 
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                            
                            min_vel = 0
                            max_vel = 0
                            
                            if os.path.exists(f"{time_dir}/fieldMinMax/minMaxMag(U)"):
                                with open(f"{time_dir}/fieldMinMax/minMaxMag(U)", 'r') as minmax_file:
                                    minmax_content = minmax_file.read()
                                    min_match = re.search(r"min\s*=\s*([0-9]+\.[0-9]+e?[-+]?[0-9]*)", minmax_content)
                                    max_match = re.search(r"max\s*=\s*([0-9]+\.[0-9]+e?[-+]?[0-9]*)", minmax_content)
                                    
                                    if min_match and max_match:
                                        min_vel = float(min_match.group(1))
                                        max_vel = float(max_match.group(1))
                            
                            self.results['velocity'] = {
                                'average': avg_velocity,
                                'min': min_vel,
                                'max': max_vel
                            }
                            
                            print(f"Velocity - Average: {avg_velocity:.2f} m/s, Min: {min_vel:.2f} m/s, Max: {max_vel:.2f} m/s")
                            
                            # Check against thresholds
                            min_acceptable = self.config['casting']['min_velocity']
                            max_acceptable = self.config['casting']['max_velocity']
                            
                            if max_vel > max_acceptable:
                                print(f"WARNING: Maximum velocity ({max_vel:.2f} m/s) exceeds threshold ({max_acceptable} m/s)")
                                print("Risk of mold erosion and excessive turbulence")
                            
                            if avg_velocity < min_acceptable:
                                print(f"WARNING: Average velocity ({avg_velocity:.2f} m/s) is below minimum threshold ({min_acceptable} m/s)")
                                print("Risk of cold shuts or incomplete filling")
                
                # Also check turbulence (k field if available)
                k_file = f"{time_dir}/k"
                if os.path.exists(k_file):
                    # Run postProcess with mag(k) to get turbulent kinetic energy
                    subprocess.run(["postProcess", "-time", time_dir, "-func", "minMaxMag(k)"], 
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    
                    if os.path.exists(f"{time_dir}/fieldMinMax/minMaxMag(k)"):
                        with open(f"{time_dir}/fieldMinMax/minMaxMag(k)", 'r') as file:
                            content = file.read()
                            max_match = re.search(r"max\s*=\s*([0-9]+\.[0-9]+e?[-+]?[0-9]*)", content)
                            
                            if max_match:
                                max_k = float(max_match.group(1))
                                self.results['turbulence'] = {
                                    'max_k': max_k
                                }
                                
                                print(f"Maximum turbulent kinetic energy: {max_k:.4f} m²/s²")
                                
                                # Check against threshold
                                max_k_acceptable = self.config['quality_checks']['max_turbulent_kinetic_energy']
                                if max_k > max_k_acceptable:
                                    print(f"WARNING: Maximum turbulence ({max_k:.4f} m²/s²) exceeds threshold ({max_k_acceptable} m²/s²)")
                                    print("Excessive turbulence may lead to gas entrapment and oxide formation")
            
            except Exception as e:
                print(f"Error analyzing flow: {e}")
                self.results['flow_analysis'] = {
                    'error': str(e)
                }
    
    def generate_report(self):
        """Generate a PDF report with analysis results and recommendations"""
        try:
            report_file = f"{self.sim_case_dir}_report.pdf"
            
            with PdfPages(report_file) as pdf:
                # Title page
                plt.figure(figsize=(8.5, 11))
                plt.axis('off')
                plt.text(0.5, 0.9, "Casting Simulation Analysis Report", fontsize=20, ha='center', fontweight='bold')
                plt.text(0.5, 0.85, f"Simulation: {self.sim_case_dir}", fontsize=14, ha='center')
                plt.text(0.5, 0.8, f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}", fontsize=12, ha='center')
                
                # Material information
                plt.text(0.1, 0.7, "Material Properties:", fontsize=14, fontweight='bold')
                plt.text(0.15, 0.65, f"Material: {self.config['material']['name']}", fontsize=12)
                plt.text(0.15, 0.62, f"Density: {self.config['material']['density']} kg/m³", fontsize=12)
                plt.text(0.15, 0.59, f"Pouring Temperature: {self.config['casting']['pouring_temperature']}°C", fontsize=12)
                
                # Simulation parameters
                plt.text(0.1, 0.53, "Simulation Parameters:", fontsize=14, fontweight='bold')
                plt.text(0.15, 0.48, f"Cavity Volume: {self.results.get('cavity_volume', 'N/A'):.6f} m³", fontsize=12)
                plt.text(0.15, 0.45, f"Metal Mass: {self.results.get('metal_mass', 'N/A'):.2f} kg", fontsize=12)
                plt.text(0.15, 0.42, f"Mass Flow Rate: {self.config['casting']['target_mass_flowrate']} kg/s", fontsize=12)
                plt.text(0.15, 0.39, f"Calculated Fill Time: {self.results.get('fill_time', 'N/A'):.2f} s", fontsize=12)
                plt.text(0.15, 0.36, f"Reynolds Number: {self.results.get('reynolds_number', 'N/A'):.2f}", fontsize=12)
                
                # Quality assessment summary
                quality_assessment = self.results.get('quality_assessment', {})
                issues = quality_assessment.get('issues', [])
                recommendations = quality_assessment.get('recommendations', [])
                status = quality_assessment.get('overall_status', 'Unknown')
                
                plt.text(0.1, 0.30, "Quality Assessment:", fontsize=14, fontweight='bold')
                plt.text(0.15, 0.26, f"Overall Status: {status}", fontsize=12, 
                         color='green' if status == 'Satisfactory' else 'red', fontweight='bold')
                
                if issues:
                    plt.text(0.15, 0.22, f"Number of Issues: {len(issues)}", fontsize=12)
                else:
                    plt.text(0.15, 0.22, "No issues detected", fontsize=12, color='green')
                
                # Add contact info
                plt.text(0.5, 0.10, "Generated by OpenFOAM Casting Simulation Analyzer", fontsize=10, ha='center')
                
                pdf.savefig()
                plt.close()
                
                # Analysis details page
                plt.figure(figsize=(8.5, 11))
                plt.axis('off')
                plt.text(0.5, 0.95, "Detailed Analysis Results", fontsize=16, ha='center', fontweight='bold')
                
                # Fill status
                y_pos = 0.9
                plt.text(0.1, y_pos, "1. Filling Analysis:", fontsize=14, fontweight='bold')
                y_pos -= 0.04
                
                fill_status = self.results.get('fill_status', {})
                if fill_status:
                    if 'unfilled_percentage' in fill_status:
                        fill_percent = (1 - fill_status['unfilled_percentage']) * 100
                        plt.text(0.15, y_pos, f"Fill Percentage: {fill_percent:.2f}%", fontsize=12)
                        y_pos -= 0.03
                        
                        acceptable = self.config['quality_checks']['acceptable_unfilled_percentage'] * 100
                        status_text = "✓ ACCEPTABLE" if fill_status['unfilled_percentage'] <= self.config['quality_checks']['acceptable_unfilled_percentage'] else "✗ ISSUE"
                        status_color = 'green' if '✓' in status_text else 'red'
                        plt.text(0.15, y_pos, f"Status: {status_text} (Threshold: {acceptable:.2f}% max unfilled)", 
                                fontsize=12, color=status_color)
                    else:
                        plt.text(0.15, y_pos, "Fill status data unavailable", fontsize=12)
                else:
                    plt.text(0.15, y_pos, "Fill status data unavailable", fontsize=12)
                
                # Temperature analysis
                y_pos -= 0.06
                plt.text(0.1, y_pos, "2. Temperature Analysis:", fontsize=14, fontweight='bold')
                y_pos -= 0.04
                
                temp = self.results.get('temperature', {})
                if temp:
                    if 'uniform' in temp and temp['uniform']:
                        plt.text(0.15, y_pos, f"Uniform Temperature: {temp.get('value', 'N/A'):.2f}°C", fontsize=12)
                        y_pos -= 0.03
                    elif 'min' in temp and 'max' in temp:
                        plt.text(0.15, y_pos, f"Temperature Range: {temp.get('min', 'N/A'):.2f}°C to {temp.get('max', 'N/A'):.2f}°C", fontsize=12)
                        y_pos -= 0.03
                        
                        min_temp = temp.get('min', 0)
                        min_acceptable = self.config['quality_checks']['min_front_temperature']
                        status_text = "✓ ACCEPTABLE" if min_temp >= min_acceptable else "✗ ISSUE"
                        status_color = 'green' if '✓' in status_text else 'red'
                        plt.text(0.15, y_pos, f"Status: {status_text} (Min temperature threshold: {min_acceptable}°C)", 
                                fontsize=12, color=status_color)
                    else:
                        plt.text(0.15, y_pos, "Temperature data incomplete", fontsize=12)
                else:
                    plt.text(0.15, y_pos, "Temperature data unavailable", fontsize=12)
                
                # Flow analysis
                y_pos -= 0.06
                plt.text(0.1, y_pos, "3. Flow Analysis:", fontsize=14, fontweight='bold')
                y_pos -= 0.04
                
                vel = self.results.get('velocity', {})
                if vel:
                    if 'average' in vel:
                        plt.text(0.15, y_pos, f"Average Velocity: {vel.get('average', 'N/A'):.2f} m/s", fontsize=12)
                        y_pos -= 0.03
                    if 'min' in vel and 'max' in vel:
                        plt.text(0.15, y_pos, f"Velocity Range: {vel.get('min', 'N/A'):.2f} m/s to {vel.get('max', 'N/A'):.2f} m/s", fontsize=12)
                        y_pos -= 0.03
                        
                        max_vel = vel.get('max', 0)
                        max_acceptable = self.config['casting']['max_velocity']
                        status_text = "✓ ACCEPTABLE" if max_vel <= max_acceptable else "✗ ISSUE"
                        status_color = 'green' if '✓' in status_text else 'red'
                        plt.text(0.15, y_pos, f"Max Velocity Status: {status_text} (Threshold: {max_acceptable} m/s)", 
                                fontsize=12, color=status_color)
                        y_pos -= 0.03
                        
                        avg_vel = vel.get('average', 0)
                        min_acceptable = self.config['casting']['min_velocity']
                        status_text = "✓ ACCEPTABLE" if avg_vel >= min_acceptable else "✗ ISSUE"
                        status_color = 'green' if '✓' in status_text else 'red'
                        plt.text(0.15, y_pos, f"Average Velocity Status: {status_text} (Threshold: {min_acceptable} m/s)", 
                                fontsize=12, color=status_color)
                    else:
                        plt.text(0.15, y_pos, "Velocity data incomplete", fontsize=12)
                else:
                    plt.text(0.15, y_pos, "Velocity data unavailable", fontsize=12)
                
                # Turbulence analysis
                y_pos -= 0.06
                plt.text(0.1, y_pos, "4. Turbulence Analysis:", fontsize=14, fontweight='bold')
                y_pos -= 0.04
                
                turb = self.results.get('turbulence', {})
                if turb and 'max_k' in turb:
                    plt.text(0.15, y_pos, f"Maximum Turbulent KE: {turb.get('max_k', 'N/A'):.4f} m²/s²", fontsize=12)
                    y_pos -= 0.03
                    
                    max_k = turb.get('max_k', 0)
                    max_k_acceptable = self.config['quality_checks']['max_turbulent_kinetic_energy']
                    status_text = "✓ ACCEPTABLE" if max_k <= max_k_acceptable else "✗ ISSUE"
                    status_color = 'green' if '✓' in status_text else 'red'
                    plt.text(0.15, y_pos, f"Status: {status_text} (Threshold: {max_k_acceptable} m²/s²)", 
                            fontsize=12, color=status_color)
                else:
                    plt.text(0.15, y_pos, "Turbulence data unavailable", fontsize=12)
                
                pdf.savefig()
                plt.close()
                
                # Issues and recommendations page
                if issues:
                    plt.figure(figsize=(8.5, 11))
                    plt.axis('off')
                    plt.text(0.5, 0.95, "Issues and Recommendations", fontsize=16, ha='center', fontweight='bold')
                    
                    y_pos = 0.9
                    plt.text(0.1, y_pos, "Issues Detected:", fontsize=14, fontweight='bold')
                    y_pos -= 0.04
                    
                    for i, issue in enumerate(issues, 1):
                        plt.text(0.15, y_pos, f"{i}. {issue}", fontsize=12)
                        y_pos -= 0.03
                        if y_pos < 0.5 and i < len(issues):
                            # Start a new column
                            y_pos = 0.9
                    
                    y_pos = min(y_pos, 0.5)  # Ensure we're at least halfway down
                    y_pos -= 0.06
                    plt.text(0.1, y_pos, "Recommendations:", fontsize=14, fontweight='bold')
                    y_pos -= 0.04
                    
                    for i, rec in enumerate(recommendations, 1):
                        plt.text(0.15, y_pos, f"{i}. {rec}", fontsize=12)
                        y_pos -= 0.03
                    
                    pdf.savefig()
                    plt.close()
                
                # Gating system assessment
                plt.figure(figsize=(8.5, 11))
                plt.axis('off')
                plt.text(0.5, 0.95, "Casting Process Assessment", fontsize=16, ha='center', fontweight='bold')
                
                y_pos = 0.9
                plt.text(0.1, y_pos, "Gating System Assessment:", fontsize=14, fontweight='bold')
                y_pos -= 0.04
                
                # Evaluate based on Reynolds number and flow patterns
                re = self.results.get('reynolds_number', 0)
                if re > 2000:
                    plt.text(0.15, y_pos, "✗ Flow indicates turbulent conditions in the gating system", fontsize=12, color='red')
                    y_pos -= 0.03
                    plt.text(0.15, y_pos, "   Recommendation: Consider redesigning gates with smoother transitions", fontsize=12)
                else:
                    plt.text(0.15, y_pos, "✓ Flow indicates controlled conditions in the gating system", fontsize=12, color='green')
                
                y_pos -= 0.06
                plt.text(0.1, y_pos, "Metal Front Velocity Assessment:", fontsize=14, fontweight='bold')
                y_pos -= 0.04
                
                vel = self.results.get('velocity', {})
                if vel and 'max' in vel:
                    max_vel = vel.get('max', 0)
                    if 0.5 <= max_vel <= 1.5:
                        plt.text(0.15, y_pos, f"✓ Metal front velocity ({max_vel:.2f} m/s) is within ideal range (0.5-1.5 m/s)", 
                                fontsize=12, color='green')
                    elif max_vel > 1.5:
                        plt.text(0.15, y_pos, f"✗ Metal front velocity ({max_vel:.2f} m/s) exceeds recommended maximum (1.5 m/s)", 
                                fontsize=12, color='red')
                        y_pos -= 0.03
                        plt.text(0.15, y_pos, "   Risk: Mold erosion, increased turbulence, and oxide formation", fontsize=12)
                    else:
                        plt.text(0.15, y_pos, f"✗ Metal front velocity ({max_vel:.2f} m/s) is below recommended minimum (0.5 m/s)", 
                                fontsize=12, color='red')
                        y_pos -= 0.03
                        plt.text(0.15, y_pos, "   Risk: Cold shuts, incomplete filling due to premature solidification", fontsize=12)
                else:
                    plt.text(0.15, y_pos, "Velocity data unavailable for assessment", fontsize=12)
                
                # Overall process assessment
                y_pos -= 0.06
                plt.text(0.1, y_pos, "Overall Process Assessment:", fontsize=14, fontweight='bold')
                y_pos -= 0.04
                
                if issues:
                    plt.text(0.15, y_pos, f"✗ Process requires optimization ({len(issues)} issues detected)", 
                            fontsize=12, color='red', fontweight='bold')
                    y_pos -= 0.03
                    plt.text(0.15, y_pos, "   Follow recommendations to improve casting quality", fontsize=12)
                else:
                    plt.text(0.15, y_pos, "✓ Process parameters appear suitable for quality casting", 
                            fontsize=12, color='green', fontweight='bold')
                
                pdf.savefig()
                plt.close()
            
            print(f"\nPDF report generated: {report_file}")
            return report_file
            
        except Exception as e:
            print(f"Error generating report: {e}")
            return None
    
    def quality_assessment(self):
        """Perform overall quality assessment based on all analysis results"""
        quality_issues = []
        recommendations = []
        
        # Check fill status
        if 'fill_status' in self.results:
            fill_status = self.results['fill_status']
            if 'unfilled_percentage' in fill_status:
                unfilled = fill_status['unfilled_percentage']
                acceptable_unfilled = self.config['quality_checks']['acceptable_unfilled_percentage']
                
                if unfilled > acceptable_unfilled:
                    quality_issues.append(f"Incomplete filling detected ({unfilled*100:.2f}% unfilled)")
                    recommendations.append("Increase filling time or pouring temperature")
        
        # Check temperature
        if 'temperature' in self.results:
            temp = self.results['temperature']
            min_acceptable = self.config['quality_checks']['min_front_temperature']
            
            if 'min' in temp and temp['min'] < min_acceptable:
                quality_issues.append(f"Temperature drops below critical threshold ({temp['min']:.2f}°C < {min_acceptable}°C)")
                recommendations.append("Increase pouring temperature or mass flow rate")
        
        # Check velocity
        if 'velocity' in self.results:
            vel = self.results['velocity']
            min_acceptable = self.config['casting']['min_velocity']
            max_acceptable = self.config['casting']['max_velocity']
            
            if 'max' in vel and vel['max'] > max_acceptable:
                quality_issues.append(f"Excessive flow velocity detected ({vel['max']:.2f} m/s > {max_acceptable} m/s)")
                recommendations.append("Reduce mass flow rate or modify gating design to slow down flow")
            
            if 'average' in vel and vel['average'] < min_acceptable:
                quality_issues.append(f"Insufficient flow velocity ({vel['average']:.2f} m/s < {min_acceptable} m/s)")
                recommendations.append("Increase mass flow rate or modify gating system to improve flow")
        
        # Check turbulence
        if 'turbulence' in self.results:
            turb = self.results['turbulence']
            max_k_acceptable = self.config['quality_checks']['max_turbulent_kinetic_energy']
            
            if 'max_k' in turb and turb['max_k'] > max_k_acceptable:
                quality_issues.append(f"Excessive turbulence detected ({turb['max_k']:.4f} m²/s² > {max_k_acceptable} m²/s²)")
                recommendations.append("Redesign gating system to reduce turbulence, consider adding filters or flow controls")
        
        # Store quality assessment in results
        self.results['quality_assessment'] = {
            'issues': quality_issues,
            'recommendations': recommendations,
            'overall_status': "Unsatisfactory" if quality_issues else "Satisfactory"
        }
        
        # Print quality assessment summary
        print("\n=== QUALITY ASSESSMENT SUMMARY ===")
        if quality_issues:
            print("Issues detected:")
            for i, issue in enumerate(quality_issues, 1):
                print(f"  {i}. {issue}")
            
            print("\nRecommendations:")
            for i, rec in enumerate(recommendations, 1):
                print(f"  {i}. {rec}")
            
            print("\nOverall status: UNSATISFACTORY")
        else:
            print("No significant issues detected.")
            print("Overall status: SATISFACTORY")
        
        return len(quality_issues) == 0
        
    def run_workflow(self):
        """Run the complete casting simulation workflow"""
        print("=== OpenFOAM Casting Simulation Workflow ===")
        
        # Step 1: Calculate mesh volume
        print("\nStep 1: Preparing case directory and analyzing mesh...")
        if not self.prepare_case_directory():
            print("Failed to prepare case directory. Aborting.")
            return False
        
        self.calculate_mesh_volume()
        
        # Step 2: Calculate simulation parameters
        print("\nStep 2: Calculating simulation parameters...")
        end_time = self.calculate_simulation_parameters()
        
        # Pre-simulation quality check
        if self.results.get('reynolds_number', 0) > self.config['casting']['max_acceptable_reynolds']:
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
            return False
        
        # Step 5: Analyze results
        print("\nStep 5: Analyzing simulation results...")
        if not self.analyze_results():
            print("Failed to analyze simulation results.")
            return False
        
        # Step 6: Generate report
        print("\nStep 6: Generating final report...")
        report_file = self.generate_report()
        
        print("\n=== Workflow Completed ===")
        if report_file:
            print(f"Final report available at: {report_file}")
        
        return True


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python optimize_casting.py <yaml_file> [base_case_dir]")
        print("Example: python optimize_casting.py aluminum.yaml sandCastingBase")
        sys.exit(1)
    
    yaml_file = sys.argv[1]
    base_case_dir = sys.argv[2] if len(sys.argv) > 2 else "sandCastingBase"
    
    simulation = CastingSimulation(yaml_file, base_case_dir)
    simulation.run_workflow()