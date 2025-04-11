#!/usr/bin/env python3
"""
Data Loader for OpenFOAM Casting Simulation Analyzer
Handles loading simulation results
"""

import sys
import json


class DataLoader:
    def __init__(self, results_file):
        """Initialize the data loader with results file path"""
        self.results_file = results_file
        self.results = {}
    
    def load_results(self):
        """Load simulation results from JSON file"""
        try:
            with open(self.results_file, 'r') as file:
                self.results = json.load(file)
                print(f"Loaded simulation results from {self.results_file}")
                return self.results
        except Exception as e:
            print(f"Error loading simulation results: {e}")
            sys.exit(1)
    
    def save_results(self, output_file=None):
        """Save results to a JSON file"""
        if output_file is None:
            output_file = self.results_file
            
        try:
            with open(output_file, 'w') as file:
                json.dump(self.results, file, indent=4)
            print(f"Results saved to {output_file}")
            return True
        except Exception as e:
            print(f"Error saving results: {e}")
            return False


def create_empty_results(output_file, simulation_status="Completed"):
    """Create a default empty results file for legacy simulations"""
    empty_results = {
        "simulation_status": simulation_status, 
        "cavity_volume": 0.002,
        "fill_time": 5.0,
        "reynolds_number": 1500
    }
    
    try:
        with open(output_file, "w") as file:
            json.dump(empty_results, file, indent=4)
        
        print(f"Created empty results file: {output_file}")
        return True
    except Exception as e:
        print(f"Error creating empty results file: {e}")
        return False