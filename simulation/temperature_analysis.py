#!/usr/bin/env python3
"""
Temperature Analysis Module for OpenFOAM Casting Simulation Analyzer
Analyzes temperature distribution from OpenFOAM simulation data
"""

import os
import re
import glob
import subprocess
import traceback
from fill_analysis import extract_numeric_values


def analyze_temperature(time_dir, results, config):
    """Analyze the temperature distribution at the given time"""
    # Check all possible temperature file locations
    temp_files = []
    
    # Look in the time directory for various possible temperature files
    possible_temp_files = ["T.metal", "T", "T.air", "T.liquid", "T.water"]
    for temp_file in possible_temp_files:
        if os.path.exists(f"{time_dir}/{temp_file}"):
            temp_files.append(f"{time_dir}/{temp_file}")
    
    # Look in processor directories
    for proc_dir in glob.glob("processor*"):
        for temp_file in possible_temp_files:
            if os.path.exists(f"{proc_dir}/{time_dir}/{temp_file}"):
                temp_files.append(f"{proc_dir}/{time_dir}/{temp_file}")
    
    print(f"Checking temperature files: {temp_files}")
    
    # If no temperature files found, try fallback method
    if not temp_files:
        print("No temperature files found. Using fallback method with estimated values.")
        # Create estimated temperature data based on configuration
        pouring_temp = config.get('casting', {}).get('pouring_temperature', 700)
        results['temperature'] = {
            'estimated': True,
            'min': pouring_temp - 50,
            'max': pouring_temp,
            'avg': pouring_temp - 20,
            'range': 50,
            'count': 1,
            'groups': 1,
            'uniform': False,
            'group_ranges': [(pouring_temp - 50, pouring_temp)]
        }
        print("Using estimated temperature data based on configuration values.")
        return True
    
    # Combined temperature values from all sources
    all_temps = []
    
    # Process each temperature file
    for temp_file in temp_files:
        try:
            # Directly read the file for debugging
            try:
                with open(temp_file, 'r') as f:
                    content = f.read(1000)  # Read first 1000 chars for inspection
                    print(f"First 100 chars of {temp_file}: {content[:100]}")
                    
                    # Extract numeric values directly from file
                    # This is a more direct approach that may work when foamDictionary fails
                    values = extract_numeric_values(content)
                    if values:
                        print(f"Directly found values in file: {values[:10]}")
                        
                        # Filter for physically plausible temperature values
                        # Accept anything above 200K (-73°C) - this includes room temperature
                        temp_values = [v for v in values if v > 200 and v < 3000]
                        if temp_values:
                            all_temps.extend(temp_values)
                            print(f"Direct file read found {len(temp_values)} valid temperatures")
            except Exception as e:
                print(f"Direct file read failed: {e}")
            
            # Use foamDictionary to extract internal field info
            print(f"Extracting temperature data from {temp_file}")
            result = subprocess.run(["foamDictionary", "-entry", "internalField", temp_file], 
                                  capture_output=True, text=True)
            
            # Check if command was successful
            if result.returncode != 0:
                print(f"foamDictionary failed: {result.stderr}")
                continue
            
            # Get the raw output first for debugging
            raw_output = result.stdout
            print(f"First 100 chars of output: {raw_output[:100]}")
            
            # Check if it's a uniform field
            if "uniform" in result.stdout:
                try:
                    uniform_part = result.stdout.split("uniform")[1].strip().rstrip(';')
                    temp_value = float(uniform_part)
                    # Accept if it's a physically plausible temperature
                    if 200 < temp_value < 3000:
                        all_temps.append(temp_value)
                        print(f"Uniform temperature: {temp_value:.2f}K ({temp_value - 273.15:.2f}°C)")
                except (ValueError, IndexError) as e:
                    print(f"Error parsing uniform value: {e}")
            else:
                # Non-uniform field - extract all numeric values
                print("Non-uniform temperature field detected")
                
                # Try to parse the output properly - first look for the exact pattern
                # This helps with standard OpenFOAM output format with numbers line by line
                if "\n" in raw_output:
                    lines = raw_output.strip().split("\n")
                    for line in lines:
                        line = line.strip()
                        # Skip lines that are clearly not temperature values
                        if ';' in line or '(' in line or 'nonuniform' in line:
                            continue
                        try:
                            # Try to convert the line to a float if it looks like just a number
                            if line and all(c.isdigit() or c in '.+-e' for c in line):
                                value = float(line)
                                if 200 < value < 3000:  # Accept realistic temperatures
                                    all_temps.append(value)
                        except ValueError:
                            pass
                
                # If we didn't find values using line-by-line, try general extraction
                if not all_temps:
                    # Extract all numeric values
                    values = extract_numeric_values(raw_output)
                    
                    # For temperature, filter for physically plausible values
                    temp_values = [v for v in values if v > 200 and v < 3000]
                    all_temps.extend(temp_values)
                    
                    if temp_values:
                        print(f"Extracted {len(temp_values)} temperature values from {temp_file}")
                        print(f"Sample temperatures (K): {temp_values[:5]}")
                    else:
                        print(f"No valid temperature values found in the range 200-3000K")
                        print(f"Raw numeric values found: {values[:10]}...")
        except Exception as e:
            print(f"Error analyzing temperature from {temp_file}: {e}")
            traceback.print_exc()
    
    # Process all collected temperature data
    if all_temps:
        # Convert to Celsius
        celsius_temps = [t - 273.15 for t in all_temps]
        
        min_temp = min(celsius_temps)
        max_temp = max(celsius_temps)
        avg_temp = sum(celsius_temps) / len(celsius_temps)
        temp_range = max_temp - min_temp
        
        # Group temperatures to identify distinct regions (e.g., metal vs. air)
        # Very simple approach: check if there's a gap of more than 100°C
        sorted_temps = sorted(celsius_temps)
        temp_groups = []
        current_group = [sorted_temps[0]]
        
        for i in range(1, len(sorted_temps)):
            if sorted_temps[i] - sorted_temps[i-1] > 100:
                # Found a major gap, end this group and start a new one
                temp_groups.append(current_group)
                current_group = [sorted_temps[i]]
            else:
                current_group.append(sorted_temps[i])
        
        # Add the last group
        temp_groups.append(current_group)
        
        # Store temperature information
        results['temperature'] = {
            'uniform': len(all_temps) == 1,
            'min': min_temp,
            'max': max_temp,
            'avg': avg_temp,
            'range': temp_range,
            'count': len(all_temps),
            'groups': len(temp_groups),
            'group_ranges': [(min(g), max(g)) for g in temp_groups],
            'sample_values': all_temps[:10]  # Store some sample values
        }
        
        print(f"Temperature analysis: Range = {min_temp:.2f}°C to {max_temp:.2f}°C (Δ{temp_range:.2f}°C)")
        print(f"Detected {len(temp_groups)} temperature groups: {[(min(g), max(g)) for g in temp_groups]}")
        
        # Check if minimum temperature is below critical threshold
        min_acceptable = config['quality_checks']['min_front_temperature']
        if min_temp < min_acceptable:
            print(f"WARNING: Minimum temperature ({min_temp:.2f}°C) is below critical threshold ({min_acceptable}°C)")
            print("Risk of cold shuts or incomplete filling")
        
        # Check extreme temperature gradient
        max_gradient = config['quality_checks'].get('max_temperature_gradient', 100)
        if temp_range > max_gradient:
            print(f"WARNING: Extreme temperature gradient detected ({temp_range:.2f}°C > {max_gradient}°C)")
            print("Risk of thermal stress, uneven solidification, and defect formation")
            
        return True
    else:
        print("WARNING: Could not extract any valid temperature data")
        # Create estimated temperature data based on configuration
        pouring_temp = config.get('casting', {}).get('pouring_temperature', 700)
        results['temperature'] = {
            'error': "Failed to analyze temperature",
            'estimated': True,
            'min': pouring_temp - 50,
            'max': pouring_temp,
            'avg': pouring_temp - 20,
            'range': 50,
            'count': 1,
            'groups': 1,
            'uniform': False,
            'group_ranges': [(pouring_temp - 50, pouring_temp)],
            'processed': False
        }
        return False