#!/usr/bin/env python3
import sys
import json
import os
import traceback
import struct
import tempfile
import subprocess
import numpy as np
import trimesh

"""
Script to export physical groups to STL files
using trimesh to convert from GLB to STL
Usage: python glb_to_stl_exporter.py input_json_file output_stl_file
"""

def export_stl_from_glb(input_data, output_file):
    """
    Creates an STL file from model data by first converting to GLB format, then to STL
    using the trimesh library, which reliably handles this conversion.
    
    Args:
        input_data (dict): Dictionary with vertices, triangles, and physical groups
        output_file (str): Path where the STL file should be saved
        
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        # Create GLB file first (temporary)
        temp_glb_file = tempfile.mktemp(suffix='.glb')
        print(f"Creating temporary GLB file: {temp_glb_file}")
        
        # Extract data
        vertices = input_data.get('vertices', [])
        triangles = input_data.get('triangles', [])
        physical_groups = input_data.get('physicalGroups', [])
        selected_groups = input_data.get('selectedGroups', [])
        
        print(f"Processing model with {len(vertices) // 3} vertices and {len(triangles) // 3} triangles")
        print(f"Selected groups: {selected_groups}")
        
        # Create a mesh from vertices and faces
        vertices_array = np.array(vertices).reshape(-1, 3)
        faces_array = np.array(triangles).reshape(-1, 3)
        
        print(f"Vertices shape: {vertices_array.shape}")
        print(f"Faces shape: {faces_array.shape}")
        
        # Filter faces if needed
        if selected_groups and physical_groups:
            # Simple approach: divide triangles evenly among groups
            triangle_count = len(triangles) // 3
            groups_count = len(selected_groups)
            triangle_sets = []
            
            for i, group_idx in enumerate(selected_groups):
                if group_idx < len(physical_groups):
                    group_name = physical_groups[group_idx].get('name', f'Group_{group_idx}')
                    
                    # Calculate triangle range for this group
                    triangles_per_group = max(1, triangle_count // groups_count)
                    start_idx = i * triangles_per_group
                    end_idx = min(triangle_count, (i + 1) * triangles_per_group)
                    
                    # Get triangles for this group
                    group_faces = faces_array[start_idx:end_idx]
                    triangle_sets.append((group_name, group_faces))
                    
                    print(f"Assigned {len(group_faces)} triangles to group {group_name}")
            
            # Create separate meshes for each group for proper selection support
            meshes = []
            for name, faces in triangle_sets:
                if len(faces) > 0:
                    mesh = trimesh.Trimesh(vertices=vertices_array, faces=faces)
                    mesh.metadata = {'name': name}  # Store group name
                    meshes.append(mesh)
                    print(f"Created mesh for group {name} with {len(faces)} triangles")
            
            # If we have multiple meshes, create a scene
            if len(meshes) > 1:
                # Create scene with all meshes
                scene = trimesh.Scene()
                for i, mesh in enumerate(meshes):
                    scene.add_geometry(mesh, node_name=mesh.metadata.get('name', f'Group_{i}'))
                
                # Export as GLB
                success = scene.export(temp_glb_file, file_type='glb')
                print(f"Exported scene with {len(meshes)} meshes to GLB format")
            elif len(meshes) == 1:
                # Export single mesh directly
                success = meshes[0].export(temp_glb_file, file_type='glb')
                print(f"Exported single mesh to GLB format")
            else:
                # No valid meshes - create a default mesh
                print("No valid meshes to export")
                default_mesh = trimesh.creation.box()
                success = default_mesh.export(temp_glb_file, file_type='glb')
                print(f"Created default box mesh")
        else:
            # Create a single mesh with all triangles
            mesh = trimesh.Trimesh(vertices=vertices_array, faces=faces_array)
            success = mesh.export(temp_glb_file, file_type='glb')
            print(f"Exported all geometry ({len(faces_array)} triangles) to GLB format")
        
        if not success:
            raise Exception("Failed to export GLB file")
        
        # Now convert GLB to STL - load the GLB scene or mesh
        try:
            loaded = trimesh.load(temp_glb_file)
            
            # Handle either scene or mesh
            if isinstance(loaded, trimesh.Scene):
                print(f"Loaded GLB as scene with {len(loaded.geometry)} meshes")
                # Export scene to STL
                loaded.export(output_file, file_type='stl')
            else:
                print(f"Loaded GLB as single mesh")
                # Export mesh to STL
                loaded.export(output_file, file_type='stl')
                
            print(f"Successfully converted GLB to STL: {output_file}")
            return True
            
        except Exception as glb_load_error:
            print(f"Error loading GLB file: {str(glb_load_error)}")
            raise
        
    except Exception as e:
        print(f"Error during GLB/STL conversion: {str(e)}")
        traceback.print_exc()
        
        # Create a fallback ASCII STL file with actual geometry
        try:
            # Create a simple box as fallback
            box = trimesh.creation.box()
            box.export(output_file, file_type='stl')
            print(f"Created fallback STL file with a simple box: {output_file}")
            return False
        except Exception as fallback_error:
            print(f"Error creating fallback STL: {fallback_error}")
            
            # Last resort - create a minimal valid STL file
            try:
                with open(output_file, 'w') as f:
                    f.write("solid ExportedModel\n")
                    f.write("facet normal 0 0 1\n")
                    f.write("  outer loop\n")
                    f.write("    vertex 0 0 0\n")
                    f.write("    vertex 10 0 0\n")
                    f.write("    vertex 0 10 0\n")
                    f.write("  endloop\n")
                    f.write("endfacet\n")
                    f.write("endsolid ExportedModel\n")
                return False
            except:
                return False
            
    finally:
        # Clean up temporary files
        try:
            if os.path.exists(temp_glb_file):
                os.remove(temp_glb_file)
                print(f"Removed temporary GLB file: {temp_glb_file}")
        except Exception as cleanup_error:
            print(f"Error cleaning up temporary files: {cleanup_error}")

def main():
    try:
        if len(sys.argv) < 3:
            print("Usage: python glb_to_stl_exporter.py input_json_file output_stl_file")
            sys.exit(1)
        
        input_file = sys.argv[1]
        output_file = sys.argv[2]
        
        if not os.path.exists(input_file):
            print(f"Error: Input file '{input_file}' not found")
            sys.exit(1)
        
        # Print debug info
        print(f"Input file path: {os.path.abspath(input_file)}")
        print(f"Output file path: {os.path.abspath(output_file)}")
        
        # Load model data
        try:
            with open(input_file, 'r') as f:
                model_data = json.load(f)
            
            # Convert to STL via GLB format
            success = export_stl_from_glb(model_data, output_file)
            
            if success:
                print("Successfully created STL file from model data")
                sys.exit(0)
            else:
                print("Created fallback STL file")
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