#!/usr/bin/env python3
"""
OpenFOAM Casting Simulation Analyzer - Main Script
This script coordinates the different modules to analyze casting simulations:
1. Loads configuration and results
2. Analyzes simulation data
3. Generates a comprehensive PDF report
"""

import os
import sys
import argparse
from config_loader import ConfigLoader, create_default_config
from data_loader import DataLoader, create_empty_results
from simulation_analyzer import SimulationAnalyzer
from report_generator import generate_report


def parse_arguments():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='OpenFOAM Casting Simulation Analyzer')
    parser.add_argument('sim_case_dir', nargs='?', help='Simulation case directory')
    parser.add_argument('--results', '-r', help='Results JSON file path')
    parser.add_argument('--config', '-c', help='Configuration YAML file path')
    parser.add_argument('--create-config', action='store_true', help='Create example configuration file')
    parser.add_argument('--force', '-f', action='store_true', help='Force analysis even with missing files')
    parser.add_argument('--detailed-report', '-d', action='store_true', help='Generate enhanced detailed report')
    
    return parser.parse_args()


def main():
    """Main function to run the simulation analysis workflow"""
    args = parse_arguments()
    
    # Create example config if requested
    if args.create_config:
        create_default_config()
        return 0
    
    # Check if simulation directory is provided
    if not args.sim_case_dir:
        print("Error: Simulation case directory is required.")
        print("Run with --help for more information.")
        return 1
    
    # Check if simulation directory exists
    if not os.path.isdir(args.sim_case_dir):
        print(f"Error: Simulation directory '{args.sim_case_dir}' not found.")
        return 1
    
    # Set default file paths if not provided
    results_file = args.results if args.results else f"{args.sim_case_dir}_results.json"
    config_file = args.config if args.config else f"{args.sim_case_dir}_config.yaml"
    
    # Check if files exist, create if needed and forced
    if not os.path.exists(results_file):
        if args.force:
            print(f"Creating empty results file: {results_file}")
            create_empty_results(results_file)
        else:
            print(f"Error: Results file '{results_file}' not found.")
            print("Use --force to create a simple results file and run analysis anyway.")
            return 1
    
    if not os.path.exists(config_file):
        if args.force:
            print(f"Creating default config file: {config_file}")
            create_default_config(config_file)
        else:
            print(f"Error: Config file '{config_file}' not found.")
            print("Use --force to use default config file for analysis.")
            return 1
    
    print("=== OpenFOAM Casting Simulation Analysis ===")
    print(f"Simulation directory: {args.sim_case_dir}")
    print(f"Results file: {results_file}")
    print(f"Config file: {config_file}")
    if args.detailed_report:
        print("Enhanced detailed report: Enabled")
    print("-------------------------------------------")
    
    # Step 1: Load configuration
    print("\nStep 1: Loading configuration...")
    config_loader = ConfigLoader(config_file)
    config = config_loader.load_config()
    
    # Step 2: Load results
    print("\nStep 2: Loading simulation results...")
    data_loader = DataLoader(results_file)
    results = data_loader.load_results()
    
    # Step 3: Analyze simulation
    print("\nStep 3: Analyzing simulation results...")
    analyzer = SimulationAnalyzer(args.sim_case_dir, results, config)
    analysis_success = analyzer.analyze_results()
    
    # Save updated results
    data_loader.results = results
    data_loader.save_results()
    
    if not analysis_success:
        print("WARNING: Analysis had some issues, report may be incomplete.")
    
    # Step 4: Generate report
    print("\nStep 4: Generating final report...")
    # Choose between standard and enhanced report based on user option
    if args.detailed_report:
        # Import the enhanced report generator only if needed
        from report_generator import generate_report
        report_file = generate_report(args.sim_case_dir, results, config)
    else:
        # Use the standard report generator
        from report_generator import generate_report
        report_file = generate_report(args.sim_case_dir, results, config)
    
    if report_file:
        print("\n=== Analysis Workflow Completed ===")
        print(f"Final report available at: {report_file}")
        return 0
    else:
        print("\n=== Analysis Workflow Completed with Errors ===")
        print("Report generation failed.")
        return 1


if __name__ == "__main__":
    sys.exit(main())