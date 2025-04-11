#!/usr/bin/env python3
"""
Simulation Analyzer Module for OpenFOAM Casting Simulation
Main module that coordinates the simulation analysis workflow
"""

import os
import glob
import traceback
from fill_analysis import analyze_fill_status
from temperature_analysis import analyze_temperature
from flow_analysis import analyze_flow
from quality_assessment import quality_assessment


class SimulationAnalyzer:
    def __init__(self, sim_case_dir, results, config):
        """Initialize the analyzer with simulation directory, results, and config"""
        self.sim_case_dir = sim_case_dir
        self.results = results
        self.config = config
    
    def analyze_results(self):
        """Analyze the simulation results for quality assessment"""
        try:
            # Change to simulation directory
            original_dir = os.getcwd()
            os.chdir(self.sim_case_dir)
            
            print("Analyzing simulation results...")
            print(f"Current directory: {os.getcwd()}")
            print(f"Available files/directories: {os.listdir('.')}")
            
            # Find the latest time directory
            time_dirs = glob.glob("[0-9]*.[0-9]*")
            time_dirs = [d for d in time_dirs if os.path.isdir(d)]
            if not time_dirs:
                raise Exception("No time directories found")
            
            # Sort time directories numerically
            time_dirs.sort(key=float)
            latest_time = time_dirs[-1]
            
            # Get calculated fill time from results
            fill_time = self.results.get('fill_time', 0)
            fill_time_dir = None
            
            # Find time directory closest to calculated fill time
            for time_dir in time_dirs:
                if float(time_dir) >= fill_time:
                    fill_time_dir = time_dir
                    break
            
            if not fill_time_dir:
                fill_time_dir = latest_time
            
            print(f"Using time directory {fill_time_dir} for fill analysis")
            
            # Check fill status at calculated fill time
            analyze_fill_status(fill_time_dir, self.results)
            
            # Check temperature distribution
            analyze_temperature(fill_time_dir, self.results, self.config)
            
            # Check velocity and turbulence
            analyze_flow(fill_time_dir, self.results, self.config)
            
            # Return to original directory
            os.chdir(original_dir)
            
            # Final quality assessment
            quality_assessment(self.results, self.config)
            
            return True
            
        except Exception as e:
            print(f"Error analyzing results: {e}")
            traceback.print_exc()
            
            # Ensure we return to the original directory
            try:
                os.chdir(original_dir)
            except:
                pass
                
            return False