#!/usr/bin/env python3
import json
import sys
import os
import tempfile
import traceback
import subprocess

# Function to create a simple IGES file with triangles from the model data
def create_iges_file_from_model(vertices, triangles, output_file):
    """
    Creates an IGES file containing triangular faces based on input vertices and triangles
    
    Args:
        vertices (list): List of vertex coordinates [x1,y1,z1,x2,y2,z2,...]
        triangles (list): List of triangle indices [i1,j1,k1,i2,j2,k2,...]
        output_file (str): Path where the IGES file should be saved
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Header sections
        start_section = "                                                                        S      1\n"
        global_section = """1H,,1H;,4HIGES,10,,32,38,6,38,15,,1.0,1,,4HUNIT,8,0.01,13H230515.103353;G      1
1H,,1H;,8HMODELDAT,10,1,8HEXPORTED,24,8,56,8,56,15,8H3DViewer;            G      2
"""
        
        # Build directory entries and parameter data for each triangle
        directory_entries = []
        parameter_data = []
        
        directory_entry_base = "     144      {:2d}       0       0       0       0       0       000010001D{:7d}\n"
        directory_entry_cont = "     144      {:2d}       0       0       1       1       0               0D{:7d}\n"
        parameter_data_base = "144,{},{},{},{},{},{},{},{},{},0,0;{:31}P{:7d}\n"
        
        # Process triangles to create IGES entities
        entry_count = 1
        p_count = 1
        vertex_count = len(vertices) // 3
        triangle_count = len(triangles) // 3
        
        print(f"Processing {triangle_count} triangles with {vertex_count} vertices")
        
        # Limit to a manageable number if very large
        max_triangles = 1000
        if triangle_count > max_triangles:
            print(f"Model has {triangle_count} triangles, limiting to {max_triangles} for IGES export")
            triangle_count = max_triangles
        
        for i in range(triangle_count):
            idx1 = triangles[i*3]
            idx2 = triangles[i*3+1] 
            idx3 = triangles[i*3+2]
            
            # Get vertex coordinates
            try:
                x1, y1, z1 = vertices[idx1*3], vertices[idx1*3+1], vertices[idx1*3+2]
                x2, y2, z2 = vertices[idx2*3], vertices[idx2*3+1], vertices[idx2*3+2]
                x3, y3, z3 = vertices[idx3*3], vertices[idx3*3+1], vertices[idx3*3+2]
                
                # Create directory entries for this triangle
                directory_entries.append(directory_entry_base.format(entry_count, entry_count))
                directory_entries.append(directory_entry_cont.format(entry_count+1, entry_count+1))
                
                # Create parameter data - triangular face
                param = parameter_data_base.format(
                    x1, y1, z1, x2, y2, z2, x3, y3, z3, "", p_count
                )
                parameter_data.append(param)
                
                entry_count += 2
                p_count += 1
            except IndexError:
                print(f"Warning: Invalid triangle indices: {idx1}, {idx2}, {idx3}")
                continue
                
        # Create section terminator
        dir_entries_str = "".join(directory_entries)
        param_data_str = "".join(parameter_data)
        
        terminate_section = f"S{1:7d}G{2:7d}D{entry_count:7d}P{p_count:7d}{' ':40}T      1"
        
        # Write the IGES file
        with open(output_file, 'w') as f:
            f.write(start_section)
            f.write(global_section)
            f.write(dir_entries_str)
            f.write(param_data_str)
            f.write(terminate_section)
        
        print(f"Successfully created IGES file: {output_file}")
        return True
    
    except Exception as e:
        print(f"Error creating IGES file: {str(e)}")
        traceback.print_exc()
        return False

def main():
    try:
        if len(sys.argv) < 3:
            print("Usage: python gmsh_export.py input_json_file output_iges_file")
            sys.exit(1)
        
        input_file = sys.argv[1]
        output_file = sys.argv[2]
        
        if not os.path.exists(input_file):
            print(f"Error: Input file '{input_file}' not found")
            sys.exit(1)
        
        # Print debug info
        print(f"Input file path: {os.path.abspath(input_file)}")
        print(f"Output file path: {os.path.abspath(output_file)}")
        
        # Create a fallback file in case of errors
        try:
            with open(output_file, 'w') as f:
                f.write("Placeholder IGES file - conversion in progress\n")
        except Exception as e:
            print(f"Warning: Could not create fallback file: {str(e)}")
        
        # Load model data
        try:
            with open(input_file, 'r') as f:
                model_data = json.load(f)
            
            vertices = model_data.get('vertices', [])
            triangles = model_data.get('triangles', [])
            physical_groups = model_data.get('physicalGroups', [])
            
            print(f"Loaded model with {len(vertices)//3} vertices, {len(triangles)//3} triangles, and {len(physical_groups)} groups")
            
            # Create a basic IGES file from the model data
            success = create_iges_file_from_model(vertices, triangles, output_file)
            
            if success:
                # Add group information to the IGES file (for future implementation)
                print("Successfully created IGES file. Physical group support will be added in a future update.")
                
                # Write a separate metadata file with group info
                metadata_file = output_file + ".meta.json"
                try:
                    with open(metadata_file, 'w') as f:
                        json.dump({
                            'physical_groups': physical_groups,
                            'source_file': os.path.basename(input_file)
                        }, f, indent=2)
                    print(f"Physical group metadata saved to {metadata_file}")
                except Exception as e:
                    print(f"Warning: Could not save group metadata: {str(e)}")
                
                sys.exit(0)
            else:
                print("Failed to create IGES file")
                sys.exit(1)
            
        except Exception as e:
            print(f"Error processing model data: {str(e)}")
            traceback.print_exc()
            sys.exit(1)
            
    except Exception as e:
        print("Fatal error in main function:")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()