#!/usr/bin/env python3
"""
Configuration Loader for OpenFOAM Casting Simulation Analyzer
Handles loading and validating configuration files
"""

import sys
import yaml
import os


class ConfigLoader:
    def __init__(self, config_file):
        """Initialize the config loader with config file path"""
        self.config_file = config_file
        self.config = None
    
    def load_config(self):
        """Load YAML configuration file"""
        try:
            with open(self.config_file, 'r') as file:
                self.config = yaml.safe_load(file)
                print(f"Loaded configuration from {self.config_file}")
            
            # Set default values for any missing configurations
            self._set_default_values()
            return self.config
            
        except Exception as e:
            print(f"Error loading configuration: {e}")
            sys.exit(1)
    
    def _set_default_values(self):
        """Set default values for missing configurations"""
        if 'quality_checks' not in self.config:
            self.config['quality_checks'] = {}
        
        quality_checks = self.config['quality_checks']
        # Set defaults if not present
        if 'max_temperature_gradient' not in quality_checks:
            quality_checks['max_temperature_gradient'] = 100
        if 'min_front_temperature' not in quality_checks:
            quality_checks['min_front_temperature'] = 500
        if 'acceptable_unfilled_percentage' not in quality_checks:
            quality_checks['acceptable_unfilled_percentage'] = 0.02
        if 'max_turbulent_kinetic_energy' not in quality_checks:
            quality_checks['max_turbulent_kinetic_energy'] = 0.5
        
        # Set defaults for casting parameters if missing
        if 'casting' not in self.config:
            self.config['casting'] = {}
        
        casting = self.config['casting']
        if 'min_velocity' not in casting:
            casting['min_velocity'] = 0.5
        if 'max_velocity' not in casting:
            casting['max_velocity'] = 1.5
    
    def create_example_config(self, output_file="example_config.yaml"):
        """Create a default example config file"""
        example_config = {
            "material": {
                "name": "Aluminum Alloy A356",
                "density": 2680,
                "specific_heat": 963,
                "thermal_conductivity": 151,
                "max_safe_temperature": 750,
                "solidus_temperature": 555,
                "liquidus_temperature": 615
            },
            "casting": {
                "pouring_temperature": 700,
                "target_mass_flowrate": 0.5,
                "min_velocity": 0.3,
                "max_velocity": 1.5
            },
            "quality_checks": {
                "acceptable_unfilled_percentage": 0.02,
                "min_front_temperature": 500,
                "max_temperature_gradient": 100,
                "max_turbulent_kinetic_energy": 0.5,
                "max_velocity_variation": 1.0
            }
        }
        
        with open(output_file, "w") as file:
            yaml.dump(example_config, file, default_flow_style=False)
        
        print(f"Example configuration created: {output_file}")
        return example_config


def create_default_config(output_file="example_config.yaml"):
    """Create a default example config file if one doesn't exist"""
    if os.path.exists(output_file):
        print(f"Config file {output_file} already exists. Not overwriting.")
        return
        
    loader = ConfigLoader(None)
    loader.create_example_config(output_file)


if __name__ == "__main__":
    # Test functionality
    if len(sys.argv) > 1:
        config_file = sys.argv[1]
        loader = ConfigLoader(config_file)
        config = loader.load_config()
        print("Configuration loaded successfully.")
    else:
        create_default_config()
        print("Example configuration file created.")