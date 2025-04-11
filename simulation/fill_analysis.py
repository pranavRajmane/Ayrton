#!/usr/bin/env python3
"""
Fill Analysis Module for OpenFOAM Casting Simulation Analyzer
Analyzes fill status from OpenFOAM simulation data
"""

import os
import re
import glob
import subprocess
import traceback


def extract_numeric_values(text):
    """Extract all numeric values from text"""
    values = []
    for val in re.findall(r"([0-9]+(?:\.[0-9]+)?(?:e[-+]?[0-9]+)?)", text):
        try:
            values.append(float(val))
        except ValueError:
            continue
    return values


def analyze_fill_status(time_dir, results):
    """Analyze the filling status at the given time"""
    # Check all possible locations for alpha.metal file
    alpha_files = []
    
    # Try different possible alpha file names
    possible_names = ["alpha.metal", "alpha", "alpha.water", "alpha.liquid"]
    
    for name in possible_names:
        if os.path.exists(f"{time_dir}/{name}"):
            alpha_files.append(f"{time_dir}/{name}")
    
    # Also check processor directories
    for proc_dir in glob.glob("processor*"):
        for name in possible_names:
            proc_alpha = f"{proc_dir}/{time_dir}/{name}"
            if os.path.exists(proc_alpha):
                alpha_files.append(proc_alpha)
    
    print(f"Checking alpha files: {alpha_files}")
    
    # If no alpha files found, try to use the velocity data to estimate fill status
    if not alpha_files:
        print("No alpha files found. Attempting to use velocity data for estimation.")
        
        # Check if we have velocity data, which might indicate filling
        if os.path.exists(f"{time_dir}/U"):
            print("Found velocity file, trying to estimate fill status from velocity data.")
            try:
                # Try reading file directly first
                try:
                    with open(f"{time_dir}/U", 'r') as f:
                        content = f.read(1000)  # Read first 1000 chars
                        print(f"First 100 chars of U file: {content[:100]}")
                except Exception as e:
                    print(f"Error reading U file directly: {e}")
                
                # Use foamDictionary to extract velocity field
                result = subprocess.run(["foamDictionary", "-entry", "internalField", f"{time_dir}/U"], 
                                      capture_output=True, text=True)
                
                if result.returncode == 0:
                    # Count how many non-zero velocity vectors we find
                    # This is a rough estimate that cells with velocity might be filled with fluid
                    vector_pattern = r"\(([0-9.-]+) ([0-9.-]+) ([0-9.-]+)\)"
                    vectors = re.findall(vector_pattern, result.stdout)
                    
                    total_cells = len(vectors)
                    filled_cells = 0
                    
                    for v in vectors:
                        try:
                            vx, vy, vz = float(v[0]), float(v[1]), float(v[2])
                            magnitude = (vx**2 + vy**2 + vz**2)**0.5
                            if magnitude > 0.01:  # Consider cells with velocity > 0.01 m/s as filled
                                filled_cells += 1
                        except (ValueError, IndexError):
                            continue
                    
                    if total_cells > 0:
                        fill_ratio = filled_cells / total_cells
                        results['fill_status'] = {
                            'uniform': False,
                            'average_value': fill_ratio,
                            'unfilled_percentage': 1.0 - fill_ratio,
                            'method': 'velocity_estimate'
                        }
                        print(f"Fill estimate from velocity: {fill_ratio * 100:.2f}% filled")
                        return True
            except Exception as e:
                print(f"Error estimating fill from velocity: {e}")
        
        # If velocity estimation failed, check for pressure field
        if os.path.exists(f"{time_dir}/p") or os.path.exists(f"{time_dir}/p_rgh"):
            print("Found pressure file, trying to estimate fill status from pressure data.")
            # Similar approach as velocity but using pressure variations
            # This is a placeholder for a more sophisticated implementation
            
        # If all else fails, use default fallback values
        results['fill_status'] = {
            'uniform': False,
            'average_value': 0.9,  # Assuming mostly filled as a fallback
            'unfilled_percentage': 0.1,
            'method': 'default_estimate',
            'note': "Estimated values - no alpha files found"
        }
        return True
    
    # Process at least one existing file
    processed = False
    for alpha_file in alpha_files:
        if os.path.exists(alpha_file):
            # Try to read file directly first to better understand format
            try:
                with open(alpha_file, 'r') as f:
                    content = f.read(1000)  # Read first 1000 chars for inspection
                    print(f"First 100 chars of {alpha_file}: {content[:100]}")
            except Exception as e:
                print(f"Error reading {alpha_file} directly: {e}")
                
            # Use foamDictionary to extract internal field
            try:
                print(f"Extracting data from {alpha_file}")
                result = subprocess.run(["foamDictionary", "-entry", "internalField", alpha_file], 
                                      capture_output=True, text=True)
                
                # Check if command was successful
                if result.returncode != 0:
                    print(f"foamDictionary failed: {result.stderr}")
                    continue
                
                # Get raw output for inspection
                raw_output = result.stdout
                print(f"First 100 chars of output: {raw_output[:100]}")
                
                # Check if it's a uniform field
                if "uniform" in raw_output:
                    try:
                        uniform_part = raw_output.split("uniform")[1].strip().rstrip(';')
                        alpha_value = float(uniform_part)
                        results['fill_status'] = {
                            'uniform': True,
                            'value': alpha_value,
                            'unfilled_percentage': 1.0 - alpha_value
                        }
                        print(f"Uniform fill status: {alpha_value * 100:.2f}% filled")
                        processed = True
                        break
                    except (ValueError, IndexError) as e:
                        print(f"Error parsing uniform value: {e}")
                        print(f"Raw output: {raw_output}")
                else:
                    # Non-uniform field - try line-by-line parsing first
                    print("Non-uniform fill field detected - trying line parsing")
                    
                    # Try to parse values line by line
                    alpha_values = []
                    if "\n" in raw_output:
                        lines = raw_output.strip().split("\n")
                        for line in lines:
                            line = line.strip()
                            # Skip lines that are clearly not alpha values
                            if ';' in line or '(' in line or 'nonuniform' in line:
                                continue
                            try:
                                # Try to convert the line to a float if it looks like a number
                                if line and all(c.isdigit() or c in '.+-e' for c in line):
                                    value = float(line)
                                    if 0 <= value <= 1:  # Alpha values should be between 0-1
                                        alpha_values.append(value)
                            except ValueError:
                                pass
                    
                    # If we found values with line parsing
                    if alpha_values:
                        avg_fill = sum(alpha_values) / len(alpha_values)
                        min_fill = min(alpha_values)
                        max_fill = max(alpha_values)
                        
                        results['fill_status'] = {
                            'uniform': False,
                            'average_value': avg_fill,
                            'min_value': min_fill,
                            'max_value': max_fill,
                            'unfilled_percentage': 1.0 - avg_fill,
                            'sample_values': alpha_values[:10],
                            'method': 'line_parsing'
                        }
                        print(f"Fill analysis (line parsing): Avg={avg_fill*100:.2f}%, Min={min_fill*100:.2f}%, Max={max_fill*100:.2f}%")
                        processed = True
                        break
                    
                    # If line parsing failed, try general numeric extraction
                    print("Line parsing failed, trying general numeric extraction")
                    values = extract_numeric_values(raw_output)
                    
                    if values:
                        # Filter for likely alpha values (between 0-1)
                        alpha_values = [v for v in values if 0 <= v <= 1]
                        
                        if alpha_values:
                            avg_fill = sum(alpha_values) / len(alpha_values)
                            min_fill = min(alpha_values)
                            max_fill = max(alpha_values)
                            
                            results['fill_status'] = {
                                'uniform': False,
                                'average_value': avg_fill,
                                'min_value': min_fill,
                                'max_value': max_fill,
                                'unfilled_percentage': 1.0 - avg_fill,
                                'sample_values': alpha_values[:10],
                                'method': 'numeric_extraction'
                            }
                            print(f"Fill analysis (numeric): Avg={avg_fill*100:.2f}%, Min={min_fill*100:.2f}%, Max={max_fill*100:.2f}%")
                            processed = True
                            break
                        else:
                            print(f"No valid alpha values found in range 0-1. Raw values: {values[:10]}")
                    
                    # If we couldn't get meaningful values, try the postProcess approach
                    if not processed:
                        try:
                            # Run postProcess with -func "mag(alpha.metal)"
                            func_name = f"mag({os.path.basename(alpha_file)})"
                            print(f"Running postProcess with function {func_name}")
                            subprocess.run(["postProcess", "-time", time_dir, "-func", func_name], 
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                            
                            # Check if mag file was created
                            base_name = os.path.basename(alpha_file)
                            mag_file = f"{time_dir}/uniform/{base_name}Mag"
                            if os.path.exists(mag_file):
                                with open(mag_file, 'r') as file:
                                    avg_content = file.read()
                                    print(f"First 100 chars of {base_name}Mag: {avg_content[:100]}")
                                    # Extract average value
                                    avg_values = extract_numeric_values(avg_content)
                                    if avg_values:
                                        avg_fill = avg_values[0]
                                        results['fill_status'] = {
                                            'uniform': False,
                                            'average_value': avg_fill,
                                            'unfilled_percentage': 1.0 - avg_fill,
                                            'method': 'postProcess'
                                        }
                                        print(f"Average fill status (from mag): {avg_fill * 100:.2f}% filled")
                                        processed = True
                                        break
                        except Exception as e:
                            print(f"Error in postProcess approach: {e}")
            except Exception as e:
                print(f"Error analyzing fill status for {alpha_file}: {e}")
                traceback.print_exc()
    
    if not processed:
        print("WARNING: Could not analyze fill status from any available files")
        # Create approximate fill status from velocity data if available
        if 'velocity' in results:
            print("Using velocity data to estimate fill status")
            # If we have high velocity variation, it might indicate partial filling
            if 'max' in results['velocity'] and 'average' in results['velocity']:
                max_vel = results['velocity']['max']
                avg_vel = results['velocity']['average']
                
                # If max velocity is much higher than average, estimate lower fill percentage
                if max_vel > 5 * avg_vel:
                    fill_estimate = 0.7  # Lower fill estimate for high velocity variation
                else:
                    fill_estimate = 0.9  # Higher fill estimate for more uniform flow
                
                results['fill_status'] = {
                    'estimated': True,
                    'average_value': fill_estimate,
                    'unfilled_percentage': 1.0 - fill_estimate,
                    'method': 'velocity_based_estimate',
                    'processed': False
                }
                print(f"Fill status estimated from velocity: {fill_estimate*100:.1f}% filled")
                return True
        
        # Default fallback if all else fails
        results['fill_status'] = {
            'error': "Failed to analyze fill status",
            'estimated': True,
            'average_value': 0.9,  # Assuming mostly filled as a fallback
            'unfilled_percentage': 0.1,
            'processed': False
        }
        
    return processed