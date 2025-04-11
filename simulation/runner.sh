#!/bin/bash
# OpenFOAM Casting Simulation Runner Script
# This script automates the workflow for OpenFOAM casting simulations

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not found. Please install Python 3."
    exit 1
fi

# Check if required Python packages are installed
python3 -c "import yaml, matplotlib, numpy, json" &> /dev/null
if [ $? -ne 0 ]; then
    echo "Installing required Python packages..."
    pip install pyyaml matplotlib numpy
fi

# Default values
YAML_FILE="aluminum.yaml"
BASE_CASE="sandCastingBase"
OUTPUT_DIR=""
ANALYZE_ONLY=false
SIM_DIR=""
FORCE_ANALYSIS=false
DETAILED_REPORT=false

# Help function
function show_help {
    echo "Usage: $0 [options]"
    echo "Options:"
    echo "  -c, --config FILE      YAML configuration file (default: aluminum.yaml)"
    echo "  -b, --base DIR         Base case directory (default: sandCastingBase)"
    echo "  -o, --output DIR       Output directory (optional)"
    echo "  -a, --analyze-only DIR Analyze existing simulation in directory (skips simulation)"
    echo "  -f, --force            Force analysis even if results file is missing"
    echo "  -d, --detailed-report  Generate enhanced detailed report"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Example: $0 --config aluminum.yaml --base sandCastingBase"
    echo "         $0 --analyze-only casting_simulation_20250407_120000"
    echo "         $0 --analyze-only casting_simulation_20250407_120000 --force --detailed-report"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    key="$1"
    
    case $key in
        -c|--config)
            YAML_FILE="$2"
            shift
            shift
            ;;
        -b|--base)
            BASE_CASE="$2"
            shift
            shift
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift
            shift
            ;;
        -a|--analyze-only)
            ANALYZE_ONLY=true
            SIM_DIR="$2"
            shift
            shift
            ;;
        -f|--force)
            FORCE_ANALYSIS=true
            shift
            ;;
        -d|--detailed-report)
            DETAILED_REPORT=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Process analyze-only mode
if [ "$ANALYZE_ONLY" = true ]; then
    if [ ! -d "$SIM_DIR" ]; then
        echo "Error: Simulation directory '$SIM_DIR' not found."
        exit 1
    fi
    
    # Use the modular Python script for analysis
    FORCE_FLAG=""
    if [ "$FORCE_ANALYSIS" = true ]; then
        FORCE_FLAG="--force"
    fi
    
    DETAILED_FLAG=""
    if [ "$DETAILED_REPORT" = true ]; then
        DETAILED_FLAG="--detailed-report"
    fi
    
    echo "========================================="
    echo " OpenFOAM Casting Simulation Analyzer"
    echo "========================================="
    echo "Analyzing existing simulation in: $SIM_DIR"
    if [ "$DETAILED_REPORT" = true ]; then
        echo "Enhanced detailed report will be generated"
    fi
    echo "-----------------------------------------"
    
    # Run the main analyzer script
    python3 main.py "$SIM_DIR" $FORCE_FLAG $DETAILED_FLAG
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo "Analysis completed successfully."
    else
        echo "Analysis exited with errors (code $EXIT_CODE)."
    fi
    
    exit $EXIT_CODE
fi

# Validate inputs for simulation mode
if [ ! -f "$YAML_FILE" ]; then
    echo "Error: Configuration file '$YAML_FILE' not found."
    exit 1
fi

if [ ! -d "$BASE_CASE" ]; then
    echo "Error: Base case directory '$BASE_CASE' not found."
    exit 1
fi

# Check if output directory is specified and exists
if [ ! -z "$OUTPUT_DIR" ]; then
    if [ ! -d "$OUTPUT_DIR" ]; then
        echo "Creating output directory: $OUTPUT_DIR"
        mkdir -p "$OUTPUT_DIR"
    fi
    # Copy the base case to the output directory
    cp -r "$BASE_CASE" "$OUTPUT_DIR/"
    BASE_CASE="$OUTPUT_DIR/$(basename "$BASE_CASE")"
fi

echo "========================================="
echo " OpenFOAM Casting Simulation Runner"
echo "========================================="
echo "Configuration file: $YAML_FILE"
echo "Base case directory: $BASE_CASE"
if [ "$DETAILED_REPORT" = true ]; then
    echo "Enhanced detailed report will be generated"
fi
echo "-----------------------------------------"

# Run the simulation script
python3 run_simulation.py "$YAML_FILE" "$BASE_CASE"
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    echo "Simulation exited with errors (code $EXIT_CODE)."
    exit $EXIT_CODE
fi

# Find the latest simulation directory and results file
SIM_DIR=$(ls -d casting_simulation_* | sort | tail -1)

if [ ! -d "$SIM_DIR" ]; then
    echo "Error: Simulation directory not found."
    exit 1
fi

echo "----------------------------------------"
echo "Simulation completed successfully."
echo "Starting analysis..."
echo "----------------------------------------"

# Run the analyzer script with or without detailed report option
DETAILED_FLAG=""
if [ "$DETAILED_REPORT" = true ]; then
    DETAILED_FLAG="--detailed-report"
fi

# Run the analyzer script
python3 main.py "$SIM_DIR" $DETAILED_FLAG
ANALYZE_CODE=$?

if [ $ANALYZE_CODE -eq 0 ]; then
    echo "Analysis completed successfully."
else
    echo "Analysis exited with errors (code $ANALYZE_CODE)."
fi

exit $ANALYZE_CODE