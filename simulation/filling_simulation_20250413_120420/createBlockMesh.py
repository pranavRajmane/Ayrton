#!/usr/bin/env python3

import sys
import numpy as np
from stl import mesh
import math

def analyze_stl(filename):
    """
    Analyze STL file and return its dimensions and bounds
    """
    try:
        # Read the STL file
        your_mesh = mesh.Mesh.from_file(filename)

        # Get the bounds
        mins = your_mesh.min_
        maxs = your_mesh.max_

        # Calculate dimensions
        dimensions = maxs - mins

        # Print detailed information
        print("STL File Analysis:")
        print(f"Minimum coordinates: {mins}")
        print(f"Maximum coordinates: {maxs}")
        print(f"Dimensions: {dimensions}")

        return mins, maxs, dimensions

    except Exception as e:
        print(f"Error analyzing STL file: {e}")
        sys.exit(1)

def generate_blockmesh_dict(mins, maxs, output_filename='blockMeshDict'):
    """
    Generate OpenFOAM blockMeshDict based on STL bounds
    """
    # Add 10% buffer to each dimension
    buffer_factor = 1.2
    
    # Calculate expanded domain
    domain_mins = mins - (maxs - mins) * ((buffer_factor - 1) / 2)
    domain_maxs = maxs + (maxs - mins) * ((buffer_factor - 1) / 2)

    # Determine cell counts (based on smallest dimension)
    dimensions = domain_maxs - domain_mins
    min_dim = min(dimensions)
    
    # Calculate cell counts (ensure at least 80 cells, scale up for larger geometries)
    def calculate_cells(length):
        base_cells = 80
        scaled_cells = math.ceil(base_cells * (length / min_dim))
        # Ensure it's an even number
        return scaled_cells if scaled_cells % 2 == 0 else scaled_cells + 1

    cell_counts = [calculate_cells(dim) for dim in dimensions]

    # Generate BlockMeshDict content
    blockmesh_content = f"""/*--------------------------------*- C++ -*----------------------------------*\\
  =========                 |
  \\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox
   \\    /   O peration     | Website:  https://openfoam.org
    \\  /    A nd           | Version:  12
     \\/     M anipulation  |
\\*---------------------------------------------------------------------------*/
FoamFile
{{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      blockMeshDict;
}}

convertToMeters 1;

vertices
(
    ({domain_mins[0]} {domain_mins[1]} {domain_mins[2]})
    ({domain_maxs[0]} {domain_mins[1]} {domain_mins[2]})
    ({domain_maxs[0]} {domain_maxs[1]} {domain_mins[2]})
    ({domain_mins[0]} {domain_maxs[1]} {domain_mins[2]})
    ({domain_mins[0]} {domain_mins[1]} {domain_maxs[2]})
    ({domain_maxs[0]} {domain_mins[1]} {domain_maxs[2]})
    ({domain_maxs[0]} {domain_maxs[1]} {domain_maxs[2]})
    ({domain_mins[0]} {domain_maxs[1]} {domain_maxs[2]})
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (10 10 10) simpleGrading (1 1 1)
);

boundary
(
    walls
    {{
        type patch;
        faces
        (
            (0 3 2 1)  // bottom face
            (4 5 6 7)  // top face
            (0 1 5 4)  // front face
            (1 2 6 5)  // right face
            (3 7 6 2)  // back face
            (0 4 7 3)  // left face
        );
    }}
);

mergePatchPairs
(
    // Optional: specify any patch merging if needed
);
"""

    # Write to file
    with open(output_filename, 'w') as f:
        f.write(blockmesh_content)

    print(f"\nBlockMeshDict generated:")
    print(f"- Output file: {output_filename}")
    print(f"- Domain size: {domain_mins} to {domain_maxs}")
    print(f"- Cell counts: {cell_counts}")

def main():
    # Check if filename is provided
    if len(sys.argv) < 2:
        print("Usage: python stl_mesh_analyzer.py <your_stl_file.stl>")
        sys.exit(1)

    # Analyze STL file
    filename = sys.argv[1]
    mins, maxs, dimensions = analyze_stl(filename)

    # Generate BlockMeshDict
    generate_blockmesh_dict(mins, maxs)

if __name__ == "__main__":
    main()