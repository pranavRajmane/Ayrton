#!/usr/bin/env python3
"""
STP/IGES Merger for Online3DViewer

This script is a modified version of final_merger.py for use within the Online3DViewer project.
It merges STEP/IGES files using the GMSH Python API.
"""

import os
import sys
import logging
import re
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('stp_merger')

# Import gmsh Python module
GMSH_AVAILABLE = True
try:
    import gmsh
except ImportError:
    logger.warning("Warning: gmsh Python module not found.")
    logger.warning("Using simple file merge instead (no proper 3D positioning).")
    GMSH_AVAILABLE = False

def simple_text_merge(file1_path, file2_path, output_path, offset=(100, 0, 0)):
    """
    Simple text-based merging of STEP/IGES files when GMSH is not available.
    This uses a very basic but reliable approach to ensure merging works.
    
    Args:
        file1_path: Path to the first STEP/IGES file
        file2_path: Path to the second STEP/IGES file
        output_path: Path where the merged file will be saved
        offset: (x, y, z) offset to apply to the second model
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        logger.info("Using simple reliable text-based merge method")
        
        # Read the content of both files
        with open(file1_path, 'r') as f1:
            file1_content = f1.read()
        
        with open(file2_path, 'r') as f2:
            file2_content = f2.read()
        
        # Check if files are STEP or IGES
        is_step1 = file1_path.lower().endswith('.stp') or file1_path.lower().endswith('.step')
        is_step2 = file2_path.lower().endswith('.stp') or file2_path.lower().endswith('.step')
        
        # Use the most reliable approach - for STEP files, use our entity offsetting
        if is_step1 and is_step2:
            return merge_step_files(file1_content, file2_content, output_path, offset)
        elif file1_path.lower().endswith('.igs') or file1_path.lower().endswith('.iges'):
            # For IGES files, use the basic approach that worked previously
            # This might not preserve face selectability but ensures the merge works
            
            # Split into lines
            file1_lines = file1_content.splitlines()
            file2_lines = file2_content.splitlines()
            
            # Identify sections by the type character in column 73
            start1_lines = [line for line in file1_lines if len(line) >= 73 and line[72] == 'S']
            global1_lines = [line for line in file1_lines if len(line) >= 73 and line[72] == 'G']
            dir1_lines = [line for line in file1_lines if len(line) >= 73 and line[72] == 'D']
            param1_lines = [line for line in file1_lines if len(line) >= 73 and line[72] == 'P']
            
            dir2_lines = [line for line in file2_lines if len(line) >= 73 and line[72] == 'D']
            param2_lines = [line for line in file2_lines if len(line) >= 73 and line[72] == 'P']
            
            # Get max entity number
            max_entity_num = 0
            for line in dir1_lines:
                if len(line) >= 8:
                    try:
                        entity_num = int(line[:8].strip())
                        if entity_num > max_entity_num:
                            max_entity_num = entity_num
                    except ValueError:
                        pass
                        
            # Offset entity numbers in second file
            processed_dir2_lines = []
            for line in dir2_lines:
                if len(line) >= 8:
                    try:
                        entity_num = int(line[:8].strip())
                        new_num = entity_num + max_entity_num
                        # Format with proper padding
                        processed_dir2_lines.append(f"{new_num:8d}" + line[8:])
                    except ValueError:
                        processed_dir2_lines.append(line)
                else:
                    processed_dir2_lines.append(line)
                    
            # Offset entity numbers in second file's parameter data
            processed_param2_lines = []
            for line in param2_lines:
                if len(line) >= 8:
                    try:
                        entity_num = int(line[:8].strip())
                        new_num = entity_num + max_entity_num
                        # Format with proper padding
                        processed_param2_lines.append(f"{new_num:8d}" + line[8:])
                    except ValueError:
                        processed_param2_lines.append(line)
                else:
                    processed_param2_lines.append(line)
                    
            # Combine all sections
            combined_dir_lines = dir1_lines + processed_dir2_lines
            combined_param_lines = param1_lines + processed_param2_lines
            
            # Build terminate line
            terminate_line = f"S{len(start1_lines):7d}G{len(global1_lines):7d}D{len(combined_dir_lines):7d}P{len(combined_param_lines):7d}T0000001{' '*40}T0000001"
            
            # Combine all sections
            all_lines = start1_lines + global1_lines + combined_dir_lines + combined_param_lines + [terminate_line]
            merged_content = '\n'.join(all_lines)
            
            # Write merged content
            with open(output_path, 'w') as f:
                f.write(merged_content)
                
            return True
        else:
            logger.warning("Files are not supported for merging")
            return False
    
    except Exception as e:
        logger.error(f"Error in simple text merge: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False

def merge_step_files(file1_content, file2_content, output_path, offset):
    """Merges two STEP files with entity offsets to preserve separate meshes."""
    try:
        logger.info("Using simple STEP file merging to maintain individual entity selectability")
        
        # Extract header and data sections
        header_pattern = r"(ISO-10303-21[\s\S]*?ENDSEC;)"
        data_pattern = r"(DATA;[\s\S]*?ENDSEC;)"
        
        # Extract parts from first file
        file1_header_match = re.search(header_pattern, file1_content)
        file1_data_match = re.search(data_pattern, file1_content)
        
        # Extract parts from second file
        file2_data_match = re.search(data_pattern, file2_content)
        
        if not file1_header_match or not file1_data_match or not file2_data_match:
            logger.error("Failed to parse STEP files")
            return False
        
        file1_header = file1_header_match.group(1)
        file1_data = file1_data_match.group(1)[5:-7]  # Remove "DATA;" and "ENDSEC;"
        file2_data = file2_data_match.group(1)[5:-7]  # Remove "DATA;" and "ENDSEC;"
        
        # Find highest entity ID in first file
        entity_id_pattern = r"#(\d+)\s*="
        matches = re.findall(entity_id_pattern, file1_data)
        max_entity_id = 0
        for match in matches:
            entity_id = int(match)
            if entity_id > max_entity_id:
                max_entity_id = entity_id
        
        logger.info(f"Highest entity ID in first STEP file: {max_entity_id}")
        
        # Replace entity references in second file
        updated_file2_data = re.sub(
            r"#(\d+)", 
            lambda m: f"#{int(m.group(1)) + max_entity_id}", 
            file2_data
        )
        
        # Add boundary marker between files (helps with selectability in viewer)
        boundary_marker = f"\n/* STEP MODEL BOUNDARY MARKER {int(time.time())} */\n"
        
        # Add translation information for the second model
        # This uses STEP representation_relationship to connect the models with a transformation
        translation_data = f"""
/* Translation for second model */
#{max_entity_id + 1}=AXIS2_PLACEMENT_3D('Translation Offset',##{max_entity_id + 2},##{max_entity_id + 3},##{max_entity_id + 4});
#{max_entity_id + 2}=DIRECTION('',(0.0,0.0,1.0));
#{max_entity_id + 3}=DIRECTION('',(1.0,0.0,0.0));
#{max_entity_id + 4}=CARTESIAN_POINT('',({offset[0]},{offset[1]},{offset[2]}));
"""
        
        # Create merged content with clear separation
        merged_content = (
            file1_header + "\n"
            "DATA;\n"
            f"{file1_data}\n"
            f"{boundary_marker}\n"
            f"{translation_data}\n"
            f"{updated_file2_data}\n"
            "ENDSEC;\n"
            "END-ISO-10303-21;\n"
        )
        
        # Write the merged file
        with open(output_path, 'w') as f:
            f.write(merged_content)
        
        logger.info(f"Merged STEP file saved to: {output_path}")
        return True
    
    except Exception as e:
        logger.error(f"Error in STEP merge: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False

def merge_iges_files(file1_content, file2_content, output_path, offset):
    """
    Merges two IGES files while preserving separate mesh identities and face structure.
    
    This implementation preserves the exact B-rep structure and carefully updates
    entity references to ensure individual faces remain selectable.
    """
    try:
        logger.info("Using enhanced IGES merge strategy to preserve face selectability")
        
        # Split into lines
        file1_lines = file1_content.splitlines()
        file2_lines = file2_content.splitlines()
        
        # Identify sections by the type character in column 73
        start1_lines = [line for line in file1_lines if len(line) >= 73 and line[72] == 'S']
        global1_lines = [line for line in file1_lines if len(line) >= 73 and line[72] == 'G']
        dir1_lines = [line for line in file1_lines if len(line) >= 73 and line[72] == 'D']
        param1_lines = [line for line in file1_lines if len(line) >= 73 and line[72] == 'P']
        
        start2_lines = [line for line in file2_lines if len(line) >= 73 and line[72] == 'S']
        global2_lines = [line for line in file2_lines if len(line) >= 73 and line[72] == 'G']
        dir2_lines = [line for line in file2_lines if len(line) >= 73 and line[72] == 'D']
        param2_lines = [line for line in file2_lines if len(line) >= 73 and line[72] == 'P']
        
        # Extract entity numbers from directory entries to create an offset map
        entity_nums_dir1 = []
        for line in dir1_lines:
            if len(line) >= 8:
                try:
                    entity_num = int(line[:8].strip())
                    entity_nums_dir1.append(entity_num)
                except ValueError:
                    pass
        
        # Get the maximum entity number as offset
        max_entity_num = max(entity_nums_dir1) if entity_nums_dir1 else 0
        logger.info(f"Highest entity number in first IGES file: {max_entity_num}")
        
        # Create a map of entity numbers to their offset versions
        entity_map = {}
        for line in dir2_lines:
            if len(line) >= 8:
                try:
                    entity_num = int(line[:8].strip())
                    entity_map[entity_num] = entity_num + max_entity_num
                except ValueError:
                    pass
        
        # Process entity references in parameter data section of file 2
        # This is critical for preserving face selectability - we need to update all references
        def update_references(param_text):
            # Create a pattern that specifically matches entity references in parameter data
            # Entity references in IGES follow formats like: 124,123,456 or 124,0,0,0,456,789
            result = param_text
            
            # Go through all entity numbers from highest to lowest to avoid partial matches
            for old_num in sorted(entity_map.keys(), reverse=True):
                new_num = entity_map[old_num]
                
                # Replace with leading comma to avoid partial matches
                # e.g., replace ,123, with ,999, but don't match 1234 
                old_str = f",{old_num},"
                new_str = f",{new_num},"
                result = result.replace(old_str, new_str)
                
                # Handle start of line (no leading comma)
                old_str = f"{old_num},"
                if result.startswith(old_str):
                    new_str = f"{new_num},"
                    result = new_str + result[len(old_str):]
                
                # Handle end of line/string (no trailing comma)
                old_str = f",{old_num}"
                if result.endswith(old_str):
                    new_str = f",{new_num}"
                    result = result[:len(result)-len(old_str)] + new_str
                
                # Handle stand-alone numbers
                if result == str(old_num):
                    result = str(new_num)
                
                # Handle semicolon-terminated references
                old_str = f",{old_num};"
                new_str = f",{new_num};"
                result = result.replace(old_str, new_str)
            
            return result
        
        # Process directory entries for second file
        processed_dir2_lines = []
        for line in dir2_lines:
            if len(line) >= 8:
                try:
                    entity_num = int(line[:8].strip())
                    new_num = entity_map.get(entity_num, entity_num + max_entity_num)
                    # Replace entity number but keep the rest of the line intact
                    processed_line = f"{new_num:8d}" + line[8:]
                    processed_dir2_lines.append(processed_line)
                except ValueError:
                    processed_dir2_lines.append(line)
            else:
                processed_dir2_lines.append(line)
        
        # Process parameter entries for second file
        processed_param2_lines = []
        for line in param2_lines:
            if len(line) >= 8:
                # First handle the entity number at the start of the line
                try:
                    entity_num = int(line[:8].strip())
                    new_num = entity_map.get(entity_num, entity_num + max_entity_num)
                    
                    # Extract param content and record section
                    param_content = line[8:]
                    record_num = ""
                    if len(param_content) >= 8 and param_content[-8:].strip().startswith('P'):
                        record_num = param_content[-8:]
                        param_content = param_content[:-8]
                    
                    # Update all entity references in the parameter data
                    updated_param = update_references(param_content)
                    
                    # Reconstruct line with updated entity number and references
                    new_line = f"{new_num:8d}{updated_param}{record_num}"
                    processed_param2_lines.append(new_line)
                except ValueError:
                    # If we can't parse the entity number, just append the line unchanged
                    processed_param2_lines.append(line)
            else:
                processed_param2_lines.append(line)
        
        # Add translation entity - IGES type 124 is a transformation matrix
        # Entity number max_entity_num+1 is reserved for this
        trans_dir_entry = f"{max_entity_num+1:8d}     124       0       0       0       0       0       000000001D      1\n"
        trans_param_entry = f"{max_entity_num+1:8d},124,{offset[0]},{offset[1]},{offset[2]},1.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,1.0;   1P      1\n"
        
        # Add marker to separate models (helps with debugging)
        marker_dir_entry = f"{max_entity_num+2:8d}     406       0       0       0       0       0       000000001D      2\n"
        marker_param_entry = f"{max_entity_num+2:8d},406,6HMODEL2;                                              1P      2\n"
        
        # Combine directory entries with our marker and transformation
        all_dir_entries = dir1_lines + [trans_dir_entry, marker_dir_entry] + processed_dir2_lines
        
        # Combine parameter entries with our marker and transformation
        all_param_entries = param1_lines + [trans_param_entry, marker_param_entry] + processed_param2_lines
        
        # Create terminate section with proper counts
        terminate_line = f"S{len(start1_lines):7d}G{len(global1_lines):7d}D{len(all_dir_entries):7d}P{len(all_param_entries):7d}T0000001{' ' * 40}T0000001\n"
        
        # Combine all sections into a complete IGES file
        merged_lines = start1_lines + global1_lines + all_dir_entries + all_param_entries + [terminate_line]
        merged_content = '\n'.join(merged_lines)
        
        # Write the merged file
        with open(output_path, 'w') as f:
            f.write(merged_content)
        
        logger.info(f"Merged IGES file with preserved face selectability saved to: {output_path}")
        return True
    
    except Exception as e:
        logger.error(f"Error in IGES merge: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return False

def merge_models(file1_path, file2_path, output_path, offset=(100, 0, 0)):
    """
    Merge two STEP/IGES files using the gmsh Python API or a simpler text method,
    ensuring individual meshes remain selectable after merging.
    
    Args:
        file1_path: Path to the first STEP/IGES file
        file2_path: Path to the second STEP/IGES file
        output_path: Path where the merged file will be saved
        offset: (x, y, z) offset to apply to the second model
    
    Returns:
        bool: True if successful, False otherwise
    """
    # If GMSH is not available, use the simple text merge approach
    if not GMSH_AVAILABLE:
        return simple_text_merge(file1_path, file2_path, output_path, offset)
    
    try:
        logger.info("Using GMSH for merging with individual entity preservation")
        # Initialize gmsh
        gmsh.initialize()
        gmsh.option.setNumber("General.Terminal", 1)
        
        # Setup for better visualization and to preserve entities
        gmsh.option.setNumber("Geometry.OCCFixSmallEdges", 0)
        gmsh.option.setNumber("Geometry.OCCFixSmallFaces", 0)
        gmsh.option.setNumber("Geometry.AutoCoherence", 0)  # Prevent auto-merging of entities
        
        # Start a new model
        gmsh.model.add("MergedModel")
        
        # Import the first file
        logger.info(f"Loading first model: {file1_path}")
        gmsh.model.occ.importShapes(file1_path)
        
        # Synchronize and get entities
        gmsh.model.occ.synchronize()
        entities1 = gmsh.model.getEntities()
        volumes1 = [tag for dim, tag in entities1 if dim == 3]
        surfaces1 = [tag for dim, tag in entities1 if dim == 2]
        
        # Create physical groups for the first model
        if volumes1 or surfaces1:
            logger.info(f"First model loaded with {len(volumes1)} volumes and {len(surfaces1)} surfaces")
            
            # Create a physical group for all volumes in model 1
            if volumes1:
                gmsh.model.addPhysicalGroup(3, volumes1, 1, "Model1")
                
                # Create individual physical groups for each volume
                for i, vol_tag in enumerate(volumes1):
                    gmsh.model.addPhysicalGroup(3, [vol_tag], 1000 + i, f"Model1_Volume_{i}")
        else:
            logger.warning("No volumes found in first model")
        
        # Import the second file with a different approach to maintain separation
        logger.info(f"Loading second model: {file2_path}")
        
        # For importing the second file, we'll use a separate model and then merge
        file_ext = os.path.splitext(file2_path)[1].lower()
        
        # Create a temporary file for the translated second model
        temp_dir = os.path.dirname(output_path)
        temp_file = os.path.join(temp_dir, f"temp_model2{file_ext}")
        
        # Import second model and save it (important step to maintain independence)
        gmsh.model.add("Model2")
        gmsh.model.occ.importShapes(file2_path)
        gmsh.model.occ.synchronize()
        
        # Get all entities from second model
        entities2 = gmsh.model.getEntities()
        volumes2 = [tag for dim, tag in entities2 if dim == 3]
        surfaces2 = [tag for dim, tag in entities2 if dim == 2]
        
        if volumes2 or surfaces2:
            logger.info(f"Second model loaded with {len(volumes2)} volumes and {len(surfaces2)} surfaces")
            
            # Create a physical group for all volumes in model 2
            if volumes2:
                gmsh.model.addPhysicalGroup(3, volumes2, 2, "Model2")
                
                # Create individual physical groups for each volume
                for i, vol_tag in enumerate(volumes2):
                    gmsh.model.addPhysicalGroup(3, [vol_tag], 2000 + i, f"Model2_Volume_{i}")
        else:
            logger.warning("No volumes found in second model")
        
        # Apply translation to the second model
        logger.info(f"Translating second model by ({offset[0]}, {offset[1]}, {offset[2]})")
        gmsh.model.occ.translate(entities2, offset[0], offset[1], offset[2])
        gmsh.model.occ.synchronize()
        
        # Save translated second model to temp file
        gmsh.write(temp_file)
        
        # Return to first model and import the translated second model
        gmsh.model.setCurrent("MergedModel")
        gmsh.model.occ.importShapes(temp_file, highestDimOnly=False)
        gmsh.model.occ.synchronize()
        
        # Clean up temporary file
        try:
            os.remove(temp_file)
        except:
            logger.warning(f"Could not remove temporary file: {temp_file}")
        
        # Get all entities from the merged model
        all_entities = gmsh.model.getEntities()
        logger.info(f"Merged model has {len(all_entities)} total entities")
        
        # Write the merged model
        logger.info(f"Saving merged model to: {output_path}")
        gmsh.write(output_path)
        
        # Clean up
        gmsh.finalize()
        
        # Check if output file exists and is not empty
        if not os.path.exists(output_path):
            logger.error(f"Output file was not created: {output_path}")
            return False
        
        if os.path.getsize(output_path) == 0:
            logger.error(f"Output file is empty: {output_path}")
            return False
        
        return True
    
    except Exception as e:
        logger.error(f"Error merging models with GMSH: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        # Try to finalize gmsh if an error occurred
        try:
            gmsh.finalize()
        except:
            pass
        
        # Fall back to simple merge if GMSH fails
        logger.info("Falling back to simple text merge")
        return simple_text_merge(file1_path, file2_path, output_path, offset)

def get_output_extension(file1_path, file2_path):
    """
    Determine the output file extension based on input files.
    If any file is IGES format, output will be IGES.
    Otherwise, output will be STEP.
    """
    file1_ext = os.path.splitext(file1_path)[1].lower()
    file2_ext = os.path.splitext(file2_path)[1].lower()
    
    # If either file is IGES, output as IGES
    if file1_ext in ['.igs', '.iges'] or file2_ext in ['.igs', '.iges']:
        return '.igs'
    
    # Default to STEP
    return '.stp'

if __name__ == "__main__":
    # Command line interface
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} file1.stp|file1.igs file2.stp|file2.igs output.stp|output.igs [x_offset] [y_offset] [z_offset]")
        sys.exit(1)
    
    file1_path = sys.argv[1]
    file2_path = sys.argv[2]
    output_path = sys.argv[3]
    
    # Get offset values if provided
    x_offset = float(sys.argv[4]) if len(sys.argv) > 4 else 100
    y_offset = float(sys.argv[5]) if len(sys.argv) > 5 else 0
    z_offset = float(sys.argv[6]) if len(sys.argv) > 6 else 0
    
    offset = (x_offset, y_offset, z_offset)
    
    print(f"Merging {file1_path} and {file2_path} with offset {offset}")
    
    # Check if files exist
    if not os.path.exists(file1_path):
        print(f"Error: File not found: {file1_path}")
        sys.exit(1)
    
    if not os.path.exists(file2_path):
        print(f"Error: File not found: {file2_path}")
        sys.exit(1)
    
    # Create output directory if it doesn't exist
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)
    
    # Merge files
    success = merge_models(file1_path, file2_path, output_path, offset)
    
    if success:
        print(f"Models successfully merged and saved to: {output_path}")
        sys.exit(0)
    else:
        print("Failed to merge models")
        sys.exit(1)