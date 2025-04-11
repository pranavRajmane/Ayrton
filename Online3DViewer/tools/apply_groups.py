#!/usr/bin/env python3
import sys
import json
import os
import traceback

"""
Script to apply physical groups to an IGES file using GMsh
Usage: python apply_groups.py input_file.iges metadata_file.json output_file.iges
"""

def apply_physical_groups(iges_file, metadata_file, output_file):
    """
    Applies physical groups from metadata to an IGES file using GMsh,
    preserving the individual face/surface selectability.
    
    Args:
        iges_file (str): Path to input IGES file
        metadata_file (str): Path to metadata JSON file with physical groups
        output_file (str): Path to save the modified IGES file
    """
    try:
        # Try to import gmsh
        import gmsh
        
        # Initialize GMsh
        gmsh.initialize()
        
        print(f"Loading IGES file: {iges_file}")
        gmsh.open(iges_file)
        
        # Load the physical group metadata
        print(f"Loading metadata from: {metadata_file}")
        with open(metadata_file, 'r') as f:
            metadata = json.load(f)
        
        # Get all entities in the model
        all_entities = gmsh.model.getEntities()
        print(f"Found {len(all_entities)} entities in the IGES file")
        
        # Separate entities by dimension
        volumes = [tag for dim, tag in all_entities if dim == 3]
        surfaces = [tag for dim, tag in all_entities if dim == 2]
        curves = [tag for dim, tag in all_entities if dim == 1]
        vertices = [tag for dim, tag in all_entities if dim == 0]
        
        print(f"Entity breakdown: {len(volumes)} volumes, {len(surfaces)} surfaces, {len(curves)} curves, {len(vertices)} vertices")
        
        # Check if this looks like a merged file with individual entity groups
        model1_volumes = []
        model2_volumes = []
        
        # Extract existing physical groups
        existing_groups = gmsh.model.getPhysicalGroups()
        physical_names = {}
        
        for dim, tag in existing_groups:
            name = gmsh.model.getPhysicalName(dim, tag)
            physical_names[(dim, tag)] = name
            print(f"Found physical group: dim={dim}, tag={tag}, name={name}")
            
            # Look for model-specific volume groups
            if dim == 3:
                if name.startswith("Model1_Volume_"):
                    model1_volumes.append(tag)
                elif name.startswith("Model2_Volume_"):
                    model2_volumes.append(tag)
        
        # Determine if this is a merged file with entity groups already defined
        is_merged_file = len(model1_volumes) > 0 and len(model2_volumes) > 0
        print(f"Is merged file with entity groups: {is_merged_file}")
        
        # If it's a merged file with entity groups, preserve them
        if is_merged_file:
            print("Using existing entity groups to maintain selectability")
            
            # Get entities for each physical group
            model1_entities = set()
            model2_entities = set()
            
            for tag in model1_volumes:
                entities = gmsh.model.getEntitiesForPhysicalGroup(3, tag)
                model1_entities.update([(3, e) for e in entities])
                
                # Get all surfaces connected to these volumes
                for vol_tag in entities:
                    bound_entities = gmsh.model.getBoundary([(3, vol_tag)], recursive=False)
                    model1_entities.update(bound_entities)
            
            for tag in model2_volumes:
                entities = gmsh.model.getEntitiesForPhysicalGroup(3, tag)
                model2_entities.update([(3, e) for e in entities])
                
                # Get all surfaces connected to these volumes
                for vol_tag in entities:
                    bound_entities = gmsh.model.getBoundary([(3, vol_tag)], recursive=False)
                    model2_entities.update(bound_entities)
            
            print(f"Model1 entities: {len(model1_entities)}")
            print(f"Model2 entities: {len(model2_entities)}")
            
            # Create surface-level physical groups for better selectability
            model1_surfaces = [tag for dim, tag in model1_entities if dim == 2]
            model2_surfaces = [tag for dim, tag in model2_entities if dim == 2]
            
            if model1_surfaces:
                print(f"Creating physical group 'Model1_Selectable_Surfaces' with {len(model1_surfaces)} surfaces")
                pg_tag = gmsh.model.addPhysicalGroup(2, model1_surfaces)
                gmsh.model.setPhysicalName(2, pg_tag, "Model1_Selectable_Surfaces")
            
            if model2_surfaces:
                print(f"Creating physical group 'Model2_Selectable_Surfaces' with {len(model2_surfaces)} surfaces")
                pg_tag = gmsh.model.addPhysicalGroup(2, model2_surfaces)
                gmsh.model.setPhysicalName(2, pg_tag, "Model2_Selectable_Surfaces")
            
            # Create individual surface groups for maximum selectability
            for i, tag in enumerate(model1_surfaces):
                pg_tag = gmsh.model.addPhysicalGroup(2, [tag])
                gmsh.model.setPhysicalName(2, pg_tag, f"Model1_Surface_{i}")
            
            for i, tag in enumerate(model2_surfaces):
                pg_tag = gmsh.model.addPhysicalGroup(2, [tag])
                gmsh.model.setPhysicalName(2, pg_tag, f"Model2_Surface_{i}")
                
        else:
            # Traditional approach for non-merged files
            physical_groups = metadata.get('physical_groups', [])
            print(f"Found {len(physical_groups)} physical groups in metadata")
            
            # Create individual groups for each surface to ensure selectability
            for i, surface_tag in enumerate(surfaces):
                pg_tag = gmsh.model.addPhysicalGroup(2, [surface_tag])
                gmsh.model.setPhysicalName(2, pg_tag, f"Surface_{i}")
            
            # Create hierarchical groups according to metadata
            for i, group in enumerate(physical_groups):
                try:
                    group_name = group.get('name', f'Group_{i}')
                    mesh_ids = group.get('meshIds', [])
                    
                    if mesh_ids:
                        # Check if this is the unassigned group
                        is_unassigned_group = "unassigned" in group_name.lower()
                        
                        if is_unassigned_group:
                            print(f"Processing unassigned faces group: {group_name}")
                            # Track already allocated surfaces for other groups
                            allocated_indices = set()
                            
                            # First pass - collect all allocated surface indices
                            for prev_i, prev_group in enumerate(physical_groups):
                                if prev_i == i:  # Skip current group
                                    continue
                                
                                prev_name = prev_group.get('name', '')
                                if "unassigned" in prev_name.lower():
                                    continue  # Skip other unassigned groups
                                    
                                prev_mesh_ids = prev_group.get('meshIds', [])
                                if not prev_mesh_ids:
                                    continue
                                
                                # Calculate surface allocation for this previous group
                                prev_total_mesh_ids = sum(len(g.get('meshIds', [])) for g in physical_groups 
                                                     if g.get('meshIds') and not "unassigned" in g.get('name', '').lower())
                                
                                if prev_total_mesh_ids > 0:
                                    prev_proportion = len(prev_mesh_ids) / prev_total_mesh_ids
                                    prev_count = max(1, int(len(surfaces) * prev_proportion))
                                    
                                    # Calculate start index for this group
                                    non_unassigned_groups = [g for g in physical_groups[:prev_i] 
                                                         if g.get('meshIds') and not "unassigned" in g.get('name', '').lower()]
                                    prev_start = sum(len(g.get('meshIds', [])) for g in non_unassigned_groups)
                                    prev_start = int((prev_start / prev_total_mesh_ids) * len(surfaces))
                                    
                                    # Add allocated indices
                                    for j in range(prev_count):
                                        allocated_indices.add((prev_start + j) % len(surfaces))
                            
                            # Use remaining unallocated surfaces
                            surface_subset = []
                            for j in range(len(surfaces)):
                                if j not in allocated_indices:
                                    surface_subset.append(surfaces[j])
                            
                            print(f"Assigning {len(surface_subset)} unallocated surfaces to {group_name}")
                        else:
                            # Standard approach for regular groups
                            # Filter out unassigned groups from total count
                            total_mesh_ids = sum(len(g.get('meshIds', [])) for g in physical_groups 
                                            if g.get('meshIds') and not "unassigned" in g.get('name', '').lower())
                            
                            if total_mesh_ids > 0:
                                # Calculate proportion of surfaces for this group
                                group_proportion = len(mesh_ids) / total_mesh_ids
                                surface_count = max(1, int(len(surfaces) * group_proportion))
                                
                                # Determine start index based on group position
                                # Only count non-unassigned groups for position calculation
                                groups_before = [g for g in physical_groups[:i] 
                                             if g.get('meshIds') and not "unassigned" in g.get('name', '').lower()]
                                
                                start_index = sum(len(g.get('meshIds', [])) for g in groups_before)
                                start_index = int((start_index / total_mesh_ids) * len(surfaces))
                                
                                # Get surface subset with wrapping to ensure we don't go out of bounds
                                surface_subset = []
                                for j in range(surface_count):
                                    idx = (start_index + j) % len(surfaces)
                                    surface_subset.append(surfaces[idx])
                            else:
                                # Fallback if no mesh_ids info
                                subset_size = max(1, len(surfaces) // len(physical_groups))
                                start_index = i * subset_size
                                surface_subset = [surfaces[j % len(surfaces)] for j in range(start_index, start_index + subset_size)]
                        
                        if surface_subset:
                            print(f"Creating physical group '{group_name}' with {len(surface_subset)} surfaces")
                            pg_tag = gmsh.model.addPhysicalGroup(2, surface_subset)
                            gmsh.model.setPhysicalName(2, pg_tag, group_name)
                except Exception as e:
                    print(f"Error creating physical group '{group_name}': {str(e)}")
        
        # Write the output IGES file
        print(f"Writing IGES file with physical groups: {output_file}")
        gmsh.write(output_file)
        
        # Finalize
        gmsh.finalize()
        print(f"Successfully applied physical groups to {output_file}")
        return True
        
    except ImportError:
        print("Error: GMsh Python API not found. Please install with 'pip install gmsh'")
        return False
    except Exception as e:
        print(f"Error applying physical groups: {str(e)}")
        traceback.print_exc()
        if 'gmsh' in sys.modules:
            try:
                gmsh.finalize()
            except:
                pass
        return False

def main():
    try:
        if len(sys.argv) != 4:
            print("Usage: python apply_groups.py input_file.iges metadata_file.json output_file.iges")
            sys.exit(1)
        
        iges_file = sys.argv[1]
        metadata_file = sys.argv[2]
        output_file = sys.argv[3]
        
        # Check if input files exist
        if not os.path.exists(iges_file):
            print(f"Error: Input IGES file '{iges_file}' not found")
            sys.exit(1)
            
        if not os.path.exists(metadata_file):
            print(f"Error: Metadata file '{metadata_file}' not found")
            sys.exit(1)
        
        # Apply physical groups
        success = apply_physical_groups(iges_file, metadata_file, output_file)
        
        if success:
            print("Physical groups successfully applied")
            sys.exit(0)
        else:
            print("Failed to apply physical groups")
            sys.exit(1)
            
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()