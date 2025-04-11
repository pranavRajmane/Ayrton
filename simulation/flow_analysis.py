#!/usr/bin/env python3
"""
Flow Analysis Module for OpenFOAM Casting Simulation Analyzer
Analyzes flow velocity and turbulence from OpenFOAM simulation data
"""

import os
import re
import glob
import subprocess
import traceback
from fill_analysis import extract_numeric_values


def analyze_flow(time_dir, results, config):
    """Analyze the flow velocity and turbulence at the given time"""
    # Check all possible velocity file locations
    u_files = []
    
    # Look in the time directory
    if os.path.exists(f"{time_dir}/U"):
        u_files.append(f"{time_dir}/U")
    
    # Look in processor directories
    for proc_dir in glob.glob("processor*"):
        if os.path.exists(f"{proc_dir}/{time_dir}/U"):
            u_files.append(f"{proc_dir}/{time_dir}/U")
    
    print(f"Checking velocity files: {u_files}")
    
    # If no velocity files found, use fallback method
    if not u_files:
        print("No velocity files found. Using fallback method with estimated values.")
        # Create estimated velocity data
        results['velocity'] = {
            'estimated': True,
            'average': 1.0,  # Moderate velocity as fallback
            'min': 0.2,
            'max': 2.0,
            'sample_values': [1.0]
        }
        print("Using estimated velocity data")
        
        # Also create estimated turbulence data
        results['turbulence'] = {
            'estimated': True,
            'max_k': 0.4,
            'min_k': 0.05,
            'avg_k': 0.2
        }
        print("Using estimated turbulence data")
        return True
    
    # Combined velocity values from all sources
    all_velocities = []
    
    # Process main directory first for primary analysis
    if f"{time_dir}/U" in u_files:
        try:
            # Run postProcess with magU to get velocity magnitude
            print(f"Analyzing flow in main directory for {time_dir}")
            subprocess.run(["postProcess", "-time", time_dir, "-func", "mag(U)"], 
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            # Check if field min/max file was created
            if os.path.exists(f"{time_dir}/uniform/UMag"):
                with open(f"{time_dir}/uniform/UMag", 'r') as file:
                    content = file.read()
                    print(f"UMag content sample: {content[:200]}")
                    # Extract average, min and max values
                    values = extract_numeric_values(content)
                    
                    if values:
                        avg_velocity = values[0]  # Usually first value is the average
                        
                        # Run postProcess with minMaxMag to get min/max
                        subprocess.run(["postProcess", "-time", time_dir, "-func", "minMaxMag(U)"], 
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        
                        min_vel = 0
                        max_vel = 0
                        
                        if os.path.exists(f"{time_dir}/fieldMinMax/minMaxMag(U)"):
                            with open(f"{time_dir}/fieldMinMax/minMaxMag(U)", 'r') as minmax_file:
                                minmax_content = minmax_file.read()
                                print(f"minMaxMag(U) content sample: {minmax_content[:200]}")
                                
                                # More robust pattern matching for min/max
                                min_match = re.search(r"min\s*=\s*([0-9]+\.[0-9]+(?:e[-+]?[0-9]+)?)", minmax_content)
                                max_match = re.search(r"max\s*=\s*([0-9]+\.[0-9]+(?:e[-+]?[0-9]+)?)", minmax_content)
                                
                                if min_match and max_match:
                                    min_vel = float(min_match.group(1))
                                    max_vel = float(max_match.group(1))
                                    all_velocities.extend([min_vel, avg_velocity, max_vel])
                        
                        results['velocity'] = {
                            'average': avg_velocity,
                            'min': min_vel,
                            'max': max_vel,
                            'sample_values': values[:10]
                        }
                        
                        print(f"Velocity - Average: {avg_velocity:.2f} m/s, Min: {min_vel:.2f} m/s, Max: {max_vel:.2f} m/s")
                        
                        # Check against thresholds
                        min_acceptable = config['casting'].get('min_velocity', 0.5)
                        max_acceptable = config['casting'].get('max_velocity', 1.5)
                        
                        if max_vel > max_acceptable:
                            print(f"WARNING: Maximum velocity ({max_vel:.2f} m/s) exceeds threshold ({max_acceptable} m/s)")
                            print("Risk of mold erosion and excessive turbulence")
                        
                        if avg_velocity < min_acceptable:
                            print(f"WARNING: Average velocity ({avg_velocity:.2f} m/s) is below minimum threshold ({min_acceptable} m/s)")
                            print("Risk of cold shuts or incomplete filling")
        except Exception as e:
            print(f"Error analyzing main flow data: {e}")
            traceback.print_exc()
    
    # Try direct extraction if postProcess approach failed
    if not 'velocity' in results and u_files:
        try:
            print("Trying direct velocity extraction from U file")
            # Take the first U file
            u_file = u_files[0]
            
            # Extract direct velocity data
            result = subprocess.run(["foamDictionary", "-entry", "internalField", u_file], 
                                  capture_output=True, text=True)
            
            if result.returncode == 0:
                # Extract vector components
                vector_pattern = r"\(([0-9.-]+) ([0-9.-]+) ([0-9.-]+)\)"
                vectors = re.findall(vector_pattern, result.stdout)
                
                velocities = []
                for v in vectors:
                    try:
                        # Calculate velocity magnitude from components
                        vx, vy, vz = float(v[0]), float(v[1]), float(v[2])
                        magnitude = (vx**2 + vy**2 + vz**2)**0.5
                        velocities.append(magnitude)
                    except (ValueError, IndexError):
                        continue
                
                if velocities:
                    min_vel = min(velocities)
                    max_vel = max(velocities)
                    avg_vel = sum(velocities) / len(velocities)
                    
                    results['velocity'] = {
                        'average': avg_vel,
                        'min': min_vel,
                        'max': max_vel,
                        'sample_values': velocities[:10],
                        'extraction_method': 'direct'
                    }
                    
                    print(f"Direct velocity extraction - Avg: {avg_vel:.2f} m/s, Min: {min_vel:.2f} m/s, Max: {max_vel:.2f} m/s")
                    all_velocities.extend(velocities)
        except Exception as e:
            print(f"Error in direct velocity extraction: {e}")
            traceback.print_exc()
    
    # Also collect velocity data from processor directories
    for u_file in u_files:
        if u_file == f"{time_dir}/U":  # Skip main directory, already processed
            continue
            
        try:
            # Extract direct velocity data
            result = subprocess.run(["foamDictionary", "-entry", "internalField", u_file], 
                                  capture_output=True, text=True)
            
            if result.returncode == 0:
                # Extract vector components
                vector_pattern = r"\(([0-9.-]+) ([0-9.-]+) ([0-9.-]+)\)"
                vectors = re.findall(vector_pattern, result.stdout)
                
                for v in vectors:
                    try:
                        # Calculate velocity magnitude from components
                        vx, vy, vz = float(v[0]), float(v[1]), float(v[2])
                        magnitude = (vx**2 + vy**2 + vz**2)**0.5
                        all_velocities.append(magnitude)
                    except (ValueError, IndexError):
                        continue
        except Exception as e:
            print(f"Error extracting velocity data from {u_file}: {e}")
    
    # If still no velocity data, use estimated values
    if not 'velocity' in results:
        print("Unable to extract velocity data. Using estimated values.")
        results['velocity'] = {
            'estimated': True,
            'average': 1.0,  # Moderate velocity as fallback
            'min': 0.2,
            'max': 2.0,
            'sample_values': [1.0]
        }
    # Supplement the velocity results with additional data if available
    elif all_velocities and 'velocity' in results:
        # Add processor-collected values
        results['velocity']['all_values_count'] = len(all_velocities)
        if len(all_velocities) > 3:  # If we have more than just min/avg/max
            all_min = min(all_velocities)
            all_max = max(all_velocities)
            all_avg = sum(all_velocities) / len(all_velocities)
            
            results['velocity']['combined_min'] = all_min
            results['velocity']['combined_max'] = all_max
            results['velocity']['combined_avg'] = all_avg
            
            print(f"Combined velocity stats - Avg: {all_avg:.2f} m/s, Min: {all_min:.2f} m/s, Max: {all_max:.2f} m/s")
    
    # Analyze turbulence
    turbulence_analyzed = analyze_turbulence(time_dir, results, config)
    
    # If turbulence analysis failed, provide estimated values
    if not turbulence_analyzed:
        results['turbulence'] = {
            'estimated': True,
            'max_k': 0.4,
            'min_k': 0.05,
            'avg_k': 0.2
        }
        print("Using estimated turbulence data")
    
    return True


def analyze_turbulence(time_dir, results, config):
    """Analyze turbulence separately to keep methods modular"""
    # Check main k file
    k_file = f"{time_dir}/k"
    if os.path.exists(k_file):
        try:
            # Run postProcess with mag(k) to get turbulent kinetic energy
            subprocess.run(["postProcess", "-time", time_dir, "-func", "minMaxMag(k)"], 
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            if os.path.exists(f"{time_dir}/fieldMinMax/minMaxMag(k)"):
                with open(f"{time_dir}/fieldMinMax/minMaxMag(k)", 'r') as file:
                    content = file.read()
                    print(f"minMaxMag(k) content sample: {content[:200]}")
                    
                    # Extract min and max values
                    max_match = re.search(r"max\s*=\s*([0-9]+\.[0-9]+(?:e[-+]?[0-9]+)?)", content)
                    min_match = re.search(r"min\s*=\s*([0-9]+\.[0-9]+(?:e[-+]?[0-9]+)?)", content)
                    
                    if max_match:
                        max_k = float(max_match.group(1))
                        min_k = float(min_match.group(1)) if min_match else 0
                        
                        # Also try to get average k
                        avg_k = None
                        if os.path.exists(f"{time_dir}/uniform/kMag"):
                            with open(f"{time_dir}/uniform/kMag", 'r') as avg_file:
                                avg_content = avg_file.read()
                                avg_values = extract_numeric_values(avg_content)
                                if avg_values:
                                    avg_k = avg_values[0]
                        
                        results['turbulence'] = {
                            'max_k': max_k,
                            'min_k': min_k,
                            'avg_k': avg_k
                        }
                        
                        print(f"Turbulence - Max KE: {max_k:.4f} m²/s², Min KE: {min_k:.4f} m²/s²")
                        if avg_k:
                            print(f"Average turbulent KE: {avg_k:.4f} m²/s²")
                        
                        # Check against threshold
                        max_k_acceptable = config['quality_checks']['max_turbulent_kinetic_energy']
                        if max_k > max_k_acceptable:
                            print(f"WARNING: Maximum turbulence ({max_k:.4f} m²/s²) exceeds threshold ({max_k_acceptable} m²/s²)")
                            print("Excessive turbulence may lead to gas entrapment and oxide formation")
                        
                        return True
        except Exception as e:
            print(f"Error analyzing turbulence: {e}")
            traceback.print_exc()
    else:
        print(f"No turbulence (k) file found at {k_file}")
        
        # Check in processor directories as fallback
        k_files = []
        for proc_dir in glob.glob("processor*"):
            proc_k = f"{proc_dir}/{time_dir}/k"
            if os.path.exists(proc_k):
                k_files.append(proc_k)
        
        if k_files:
            print(f"Found turbulence files in processor directories: {k_files}")
            try:
                # Try to extract k values directly from the first processor file
                result = subprocess.run(["foamDictionary", "-entry", "internalField", k_files[0]], 
                                      capture_output=True, text=True)
                
                if result.returncode == 0:
                    # Extract numeric values
                    k_values = extract_numeric_values(result.stdout)
                    
                    if k_values:
                        min_k = min(k_values)
                        max_k = max(k_values)
                        avg_k = sum(k_values) / len(k_values)
                        
                        results['turbulence'] = {
                            'max_k': max_k,
                            'min_k': min_k,
                            'avg_k': avg_k,
                            'extraction_method': 'direct'
                        }
                        
                        print(f"Direct turbulence extraction - Avg KE: {avg_k:.4f} m²/s², Min: {min_k:.4f} m²/s², Max: {max_k:.4f} m²/s²")
                        return True
            except Exception as e:
                print(f"Error in direct turbulence extraction: {e}")
                traceback.print_exc()
    
    # If we reached here, turbulence analysis failed
    return False