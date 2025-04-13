#!/bin/bash
# Casting simulation runner script
# This script automates the workflow for OpenFOAM casting simulations

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is required but not found. Please install Python 3."
    exit 1
fi

# Check if required Python packages are installed
python3 -c "import yaml, matplotlib, numpy" &> /dev/null
if [ $? -ne 0 ]; then
    echo "Installing required Python packages..."
    pip install pyyaml matplotlib numpy
fi

# Default values
YAML_FILE="aluminum.yaml"
BASE_CASE="sandCastingBase"
OUTPUT_DIR=""

# Help function
function show_help {
    echo "Usage: $0 [options]"
    echo "Options:"
    echo "  -c, --config FILE      YAML configuration file (default: aluminum.yaml)"
    echo "  -b, --base DIR         Base case directory (default: sandCastingBase)"
    echo "  -o, --output DIR       Output directory (optional)"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Example: $0 --config aluminum.yaml --base sandCastingBase"
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

# Validate inputs
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
echo "----------------------------------------"

# Run the Python script
python3 optimize_casting.py "$YAML_FILE" "$BASE_CASE"
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "Simulation completed successfully."
else
    echo "Simulation exited with errors (code $EXIT_CODE)."
fi

exit $EXIT_CODE