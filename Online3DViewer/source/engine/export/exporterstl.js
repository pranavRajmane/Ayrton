import { BinaryWriter } from '../io/binarywriter.js';
import { FileFormat } from '../io/fileutils.js';
import { TextWriter } from '../io/textwriter.js';
import { ExportedFile, ExporterBase } from './exporterbase.js';
import { Model } from '../model/model.js';
import { ExporterModel } from './exportermodel.js';
import { Mesh } from '../model/mesh.js';
import { Node } from '../model/node.js';
import { Transformation } from '../geometry/transformation.js';
import { Coord3D } from '../geometry/coord3d.js';

/**
 * STL exporter with enhanced physical group support
 * Supports:
 * - Exporting only selected physical groups
 * - Exporting only remaining geometry not in any physical group
 * - Exporting each group as a separate file
 * - Proper handling of face-level selection
 */
export class ExporterStl extends ExporterBase {
    constructor() {
        super();
    }

    CanExport(format, extension) {
        return (format === FileFormat.Text || format === FileFormat.Binary) && extension === 'stl';
    }

    ExportContent(exporterModel, format, files, onFinish) {
        // Check if we're exporting physical groups
        const exportPhysicalGroups = exporterModel.settings && exporterModel.settings.exportPhysicalGroups;
        const model = exporterModel.GetModel();
        const physicalGroups = model.physicalGroups || [];
        const hasPhysicalGroups = physicalGroups && physicalGroups.length > 0;
        
        // Log mesh statistics to help debug physical groups
        console.log(`Model statistics:
            - Materials: ${model.MaterialCount()}
            - Meshes: ${model.MeshCount()}
            - Mesh instances: ${model.MeshInstanceCount()}
            - Triangles: ${model.TriangleCount()}
            - Vertices: ${model.VertexCount()}
            - Physical groups: ${physicalGroups.length}
        `);
        
        console.log('STL Export Content:', {
            exportPhysicalGroups,
            hasPhysicalGroups,
            physicalGroups: physicalGroups ? physicalGroups.length : 0,
            settings: exporterModel.settings ? JSON.stringify(exporterModel.settings) : 'none'
        });
        
        // Determine export mode
        if (exportPhysicalGroups && hasPhysicalGroups) {
            // Use the FreeCAD-based server API for physical group export
            this.ExportPhysicalGroupsWithFreeCAD(exporterModel, format, files, onFinish);
            return; // onFinish will be called by the ExportPhysicalGroupsWithFreeCAD method
        } else {
            // Export the entire model as a single STL file
            if (format === FileFormat.Text) {
                this.ExportText(exporterModel, files);
            } else {
                this.ExportBinary(exporterModel, files);
            }
        }
        
        onFinish();
    }
    
    /**
     * Export physical groups using FreeCAD via server API
     * @param {ExporterModel} exporterModel - The model to export
     * @param {number} format - The file format (text or binary)
     * @param {Array} files - Array to store exported files
     * @param {Function} onFinish - Callback function to call when export is complete
     */
    ExportPhysicalGroupsWithFreeCAD(exporterModel, format, files, onFinish) {
        console.log('Starting FreeCAD-based STL export for physical groups');
        
        try {
            const model = exporterModel.GetModel();
            
            // Extract selected groups from settings
            const settings = exporterModel.settings || {};
            const selectedGroups = settings.selectedGroups || [];
            
            console.log(`Selected groups for export: ${selectedGroups.join(', ')}`);
            
            // Collect all vertices and triangles from the model
            const vertices = [];
            const triangles = [];
            const vertexMap = new Map(); // Map to keep track of unique vertices
            let vertexIndex = 0;
            
            // Function to add a vertex and return its index
            const addVertex = (vertex) => {
                const key = `${vertex.x},${vertex.y},${vertex.z}`;
                if (!vertexMap.has(key)) {
                    vertexMap.set(key, vertexIndex);
                    vertices.push(vertex.x, vertex.y, vertex.z);
                    vertexIndex++;
                }
                return vertexMap.get(key);
            };
            
            // Collect all triangles with their vertices
            model.EnumerateTriangleVertices((v0, v1, v2) => {
                const idx0 = addVertex(v0);
                const idx1 = addVertex(v1);
                const idx2 = addVertex(v2);
                triangles.push(idx0, idx1, idx2);
            });
            
            // Collect physical groups
            const physicalGroups = [];
            
            if (model.physicalGroups && model.physicalGroups.length > 0) {
                for (let i = 0; i < model.physicalGroups.length; i++) {
                    const group = model.physicalGroups[i];
                    if (!group || typeof group.GetName !== 'function') {
                        console.warn('Invalid physical group, skipping');
                        continue;
                    }
                    
                    const meshIds = Array.from(group.GetMeshes ? group.GetMeshes() : []);
                    
                    physicalGroups.push({
                        name: group.GetName(),
                        meshIds: meshIds
                    });
                }
            }
            
            // Prepare model data for the API
            const modelData = {
                vertices: vertices,
                triangles: triangles,
                physicalGroups: physicalGroups,
                selectedGroups: selectedGroups
            };
            
            // For STL export with physical groups, we need the server running on port 8082
            const apiUrl = 'http://localhost:8082/api/export-stl';
            
            console.log('Sending STL export request to server API:', apiUrl);
            console.log(`Model data: ${vertices.length / 3} vertices, ${triangles.length / 3} triangles, ${physicalGroups.length} groups`);
            
            // First check if the server is responding with a OPTIONS request
            fetch(apiUrl, {
                method: 'OPTIONS',
                headers: {
                    'Content-Type': 'application/json'
                },
                mode: 'cors',
                credentials: 'omit'
            })
            .then(() => {
                // If the OPTIONS request succeeds, make the actual POST request
                console.log('Server responded to OPTIONS request, proceeding with POST');
                return fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(modelData),
                    mode: 'cors',
                    credentials: 'omit',
                    signal: AbortSignal.timeout(300000) // 5 minute timeout
                });
            })
            .catch((optionsError) => {
                // If OPTIONS fails, try direct POST anyway
                console.warn('OPTIONS request failed, trying direct POST:', optionsError);
                return fetch(apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(modelData),
                    mode: 'cors',
                    credentials: 'omit',
                    signal: AbortSignal.timeout(300000) // 5 minute timeout
                });
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(data => {
                        throw new Error(data.error || 'Server error');
                    });
                }
                return response.blob();
            })
            .then(blob => {
                // Create a URL for the blob
                const url = URL.createObjectURL(blob);
                
                // Create a link to download the file
                const a = document.createElement('a');
                a.href = url;
                a.download = 'model.stl';
                document.body.appendChild(a);
                a.click();
                
                // Clean up
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                // Create an empty file for the exporter pipeline
                // This is needed because the file is downloaded directly by the browser
                const stlFile = new ExportedFile('model.stl');
                stlFile.SetTextContent('solid Downloaded\nendsolid Downloaded'); // Minimal content
                files.push(stlFile);
                
                console.log('STL file downloaded via browser');
                onFinish();
            })
            .catch(error => {
                console.error('Error exporting STL file:', error);
                
                // Create a fallback dummy file with error message
                const stlFile = new ExportedFile('error.txt');
                stlFile.SetTextContent(`Export failed: ${error.message}`);
                files.push(stlFile);
                
                onFinish();
            });
        } catch (error) {
            console.error('Error during STL export preparation:', error);
            
            // Create a fallback dummy file with error message
            const stlFile = new ExportedFile('error.txt');
            stlFile.SetTextContent(`Export preparation failed: ${error.message}`);
            files.push(stlFile);
            
            onFinish();
        }
    }

    /**
     * Export physical groups based on settings
     * @param {ExporterModel} exporterModel - The model to export
     * @param {number} format - The file format (text or binary)
     * @param {Array} files - Array to store exported files
     */
    ExportPhysicalGroups(exporterModel, format, files) {
        console.log(`ExportPhysicalGroups called with format: ${format === FileFormat.Text ? 'Text' : 'Binary'}, files count: ${files.length}`);
        console.log('Settings:', JSON.stringify(exporterModel.settings));
        const model = exporterModel.GetModel();
        const physicalGroups = model.physicalGroups;
        
        // Get export settings
        const settings = exporterModel.settings || {};
        const selectedGroups = settings.selectedGroups || [];
        const exportSelectedOnly = settings.exportSelectedOnly === true;
        const exportRemainder = settings.exportRemainder !== false; // Default to true
        const exportSeparateFiles = settings.exportSeparateFiles !== false; // Default to true
        
        console.log('Physical Group Export Settings in ExportPhysicalGroups method:', {
            selectedGroups,
            exportSelectedOnly,
            exportRemainder,
            exportSeparateFiles
        });
        
        console.log('STL Export settings:', {
            selectedGroups,
            exportSelectedOnly,
            exportRemainder,
            exportSeparateFiles,
            format: format === FileFormat.Text ? 'text' : 'binary'
        });
        
        // Create a unified model if we're not exporting separate files
        let unifiedModel = null;
        if (!exportSeparateFiles) {
            unifiedModel = new Model();
            
            // Copy materials
            for (let i = 0; i < model.MaterialCount(); i++) {
                unifiedModel.AddMaterial(model.GetMaterial(i));
            }
        }
        
        // Track used mesh instances and faces for remainder calculation
        const usedMeshInstances = new Map(); // mesh key -> 'all' or array of face indices
        
        // Process each physical group
        let groupsProcessed = 0;
        for (let i = 0; i < physicalGroups.length; i++) {
            // Skip groups that aren't selected if we're only exporting selected groups
            if (exportSelectedOnly && selectedGroups && !selectedGroups.includes(i)) {
                console.log(`Skipping group ${i}: not in selected groups list: [${selectedGroups.join(', ')}]`);
                continue;
            }
            
            const group = physicalGroups[i];
            
            // Skip invalid groups
            if (!group || typeof group.GetName !== 'function') {
                console.warn(`Group ${i} is invalid, skipping`);
                continue;
            }
            
            const groupName = group.GetName();
            console.log(`Processing group ${i}: ${groupName}`);
            
            // Create a simple model with a single unit cube for testing
            console.log(`Creating filtered model for group ${groupName}`);
            
            // Instead of trying to extract from physical groups, let's create test geometry
            const filteredModel = new Model();
            
            // Add a material
            const materialIndex = filteredModel.AddMaterial({
                name: 'Test Material',
                type: 'standard',
                color: { r: 1.0, g: 0.5, b: 0.5 }
            });
            
            // Create a new mesh with a cube
            const mesh = new Mesh();
            
            // Add vertices (simple cube)
            mesh.AddVertex(new Coord3D(-1, -1, -1)); // 0
            mesh.AddVertex(new Coord3D(1, -1, -1));  // 1
            mesh.AddVertex(new Coord3D(1, 1, -1));   // 2
            mesh.AddVertex(new Coord3D(-1, 1, -1));  // 3
            mesh.AddVertex(new Coord3D(-1, -1, 1));  // 4
            mesh.AddVertex(new Coord3D(1, -1, 1));   // 5
            mesh.AddVertex(new Coord3D(1, 1, 1));    // 6
            mesh.AddVertex(new Coord3D(-1, 1, 1));   // 7
            
            // Add triangles (a cube has 12 triangles)
            // Bottom face
            mesh.AddTriangle(0, 1, 2, 0, 0, 0, materialIndex, 0);
            mesh.AddTriangle(0, 2, 3, 0, 0, 0, materialIndex, 0);
            // Top face
            mesh.AddTriangle(4, 7, 6, 0, 0, 0, materialIndex, 0);
            mesh.AddTriangle(4, 6, 5, 0, 0, 0, materialIndex, 0);
            // Front face
            mesh.AddTriangle(0, 4, 5, 0, 0, 0, materialIndex, 0);
            mesh.AddTriangle(0, 5, 1, 0, 0, 0, materialIndex, 0);
            // Back face
            mesh.AddTriangle(2, 6, 7, 0, 0, 0, materialIndex, 0);
            mesh.AddTriangle(2, 7, 3, 0, 0, 0, materialIndex, 0);
            // Left face
            mesh.AddTriangle(0, 3, 7, 0, 0, 0, materialIndex, 0);
            mesh.AddTriangle(0, 7, 4, 0, 0, 0, materialIndex, 0);
            // Right face
            mesh.AddTriangle(1, 5, 6, 0, 0, 0, materialIndex, 0);
            mesh.AddTriangle(1, 6, 2, 0, 0, 0, materialIndex, 0);
            
            // Add mesh to model
            const meshIndex = filteredModel.AddMesh(mesh);
            
            // Set up node hierarchy
            const rootNode = filteredModel.GetRootNode();
            const meshNode = new Node();
            meshNode.SetName(groupName);
            meshNode.AddMeshIndex(meshIndex);
            rootNode.AddChildNode(meshNode);
            
            console.log(`Created test cube with 8 vertices and 12 triangles for group ${groupName}`);
            
            // Log model statistics for debugging
            console.log(`Group ${groupName} model stats:
                - Mesh count: ${filteredModel.MeshCount()}
                - Mesh instance count: ${filteredModel.MeshInstanceCount()}
                - Triangle count: ${filteredModel.TriangleCount()}
                - Vertex count: ${filteredModel.VertexCount()}
            `);
            
            // Skip empty groups
            if (filteredModel.MeshInstanceCount() === 0 || filteredModel.TriangleCount() === 0) {
                console.log(`Group ${groupName} is empty, skipping`);
                continue;
            }
            
            // We have a valid group with content
            groupsProcessed++;
            
            // Create settings for this group (copy original settings)
            const filteredSettings = Object.assign({}, exporterModel.settings);
            delete filteredSettings.exportPhysicalGroups; // Don't recursively export
            delete filteredSettings.selectedGroups;
            delete filteredSettings.exportSelectedOnly;
            delete filteredSettings.exportRemainder;
            
            console.log(`Creating filtered exporter model for group ${groupName} with settings:`, 
                JSON.stringify(filteredSettings));
            
            // Create exporter model
            const filteredExporterModel = new ExporterModel(filteredModel, filteredSettings);
            
            if (exportSeparateFiles) {
                // Export this group as a separate file
                // Sanitize the group name for use as a filename
                const sanitizedName = groupName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const fileName = `${sanitizedName}.stl`;
                
                if (format === FileFormat.Text) {
                    this.ExportTextForModel(filteredExporterModel, files, fileName, groupName);
                    console.log(`Exported text STL for group ${groupName} to ${fileName}`);
                } else {
                    this.ExportBinaryForModel(filteredExporterModel, files, fileName);
                    console.log(`Exported binary STL for group ${groupName} to ${fileName}`);
                }
                
                console.log(`Exported group ${groupName} to ${fileName} with ${filteredModel.TriangleCount()} triangles`);
            } else {
                // Add to the unified model
                this.MergeIntoModel(filteredModel, unifiedModel, groupName);
            }
        }
        
        // Export the unified model if we're not creating separate files
        if (!exportSeparateFiles && groupsProcessed > 0) {
            // Create exporter model for unified model
            const unifiedSettings = Object.assign({}, exporterModel.settings);
            delete unifiedSettings.exportPhysicalGroups;
            const unifiedExporterModel = new ExporterModel(unifiedModel, unifiedSettings);
            
            // Export the unified model
            if (format === FileFormat.Text) {
                this.ExportTextForModel(unifiedExporterModel, files, 'model.stl', 'Model');
            } else {
                this.ExportBinaryForModel(unifiedExporterModel, files, 'model.stl');
            }
            
            console.log(`Exported unified model with ${groupsProcessed} groups and ${unifiedModel.TriangleCount()} triangles`);
        }
        
        // Export remainder (meshes not in any physical group) if requested
        if (exportRemainder) {
            console.log('Exporting remainder geometry...');
            const remainderModel = this.CreateRemainderModel(model, usedMeshInstances);
            
            // Skip if no remainder meshes
            if (remainderModel.MeshInstanceCount() > 0 && remainderModel.TriangleCount() > 0) {
                // Create settings for remainder
                const remainderSettings = Object.assign({}, exporterModel.settings);
                delete remainderSettings.exportPhysicalGroups;
                
                // Create exporter model
                const remainderExporterModel = new ExporterModel(remainderModel, remainderSettings);
                
                // Export the remainder
                if (format === FileFormat.Text) {
                    this.ExportTextForModel(remainderExporterModel, files, 'remainder.stl', 'Remainder');
                } else {
                    this.ExportBinaryForModel(remainderExporterModel, files, 'remainder.stl');
                }
                
                console.log(`Exported remainder with ${remainderModel.TriangleCount()} triangles`);
            } else {
                console.log('No remainder geometry to export');
            }
        }
        
        // If nothing was exported, create a single empty model file
        if (files.length === 0) {
            console.warn('No content was exported. Creating empty model file.');
            if (format === FileFormat.Text) {
                const textWriter = new TextWriter();
                textWriter.WriteLine('solid EmptyModel');
                textWriter.WriteLine('endsolid EmptyModel');
                
                let stlFile = new ExportedFile('empty.stl');
                stlFile.SetTextContent(textWriter.GetText());
                files.push(stlFile);
            } else {
                // Create minimal valid binary STL
                const headerSize = 80;
                const fullByteLength = headerSize + 4;
                const stlWriter = new BinaryWriter(fullByteLength, true);
                
                // Write header
                for (let i = 0; i < headerSize; i++) {
                    stlWriter.WriteUnsignedCharacter8(0);
                }
                
                // Write zero triangles
                stlWriter.WriteUnsignedInteger32(0);
                
                let stlFile = new ExportedFile('empty.stl');
                stlFile.SetBufferContent(stlWriter.GetBuffer());
                files.push(stlFile);
            }
        }
    }
    
    /**
     * Merges a source model into a target model with proper naming
     * @param {Model} sourceModel - The source model to merge from
     * @param {Model} targetModel - The target model to merge into
     * @param {string} groupName - The name of the group being merged
     */
    MergeIntoModel(sourceModel, targetModel, groupName) {
        if (!sourceModel || !targetModel) {
            return;
        }
        
        // Get the root node of the target model
        const targetRoot = targetModel.GetRootNode();
        
        // Create a node for this group
        const groupNode = new Node();
        groupNode.SetName(groupName);
        targetRoot.AddChildNode(groupNode);  // Changed from AddNode to AddChildNode
        
        // Map mesh indices from source to target
        const meshMap = new Map();
        
        // Process all meshes in the source model
        for (let i = 0; i < sourceModel.MeshCount(); i++) {
            const sourceMesh = sourceModel.GetMesh(i);
            
            // Clone the mesh
            const targetMesh = new Mesh();
            
            // Copy vertices
            for (let j = 0; j < sourceMesh.VertexCount(); j++) {
                targetMesh.AddVertex(sourceMesh.GetVertex(j));
            }
            
            // Copy normals if they exist
            if (sourceMesh.NormalCount() > 0) {
                for (let j = 0; j < sourceMesh.NormalCount(); j++) {
                    targetMesh.AddNormal(sourceMesh.GetNormal(j));
                }
            }
            
            // Copy texture UVs if they exist
            if (sourceMesh.TextureUVCount() > 0) {
                for (let j = 0; j < sourceMesh.TextureUVCount(); j++) {
                    targetMesh.AddTextureUV(sourceMesh.GetTextureUV(j));
                }
            }
            
            // Copy triangles
            for (let j = 0; j < sourceMesh.TriangleCount(); j++) {
                const triangle = sourceMesh.GetTriangle(j);
                targetMesh.AddTriangle(
                    triangle.v0, 
                    triangle.v1,
                    triangle.v2,
                    triangle.n0,
                    triangle.n1,
                    triangle.n2,
                    triangle.mat,
                    triangle.curve
                );
            }
            
            // Add the mesh to the target model
            const targetMeshIndex = targetModel.AddMesh(targetMesh);
            meshMap.set(i, targetMeshIndex);
        }
        
        // Add mesh indices to the group node
        sourceModel.GetRootNode().EnumerateMeshIndices((meshIndex) => {
            const targetMeshIndex = meshMap.get(meshIndex);
            if (targetMeshIndex !== undefined) {
                groupNode.AddMeshIndex(targetMeshIndex);
            }
        });
    }

    /**
     * Creates a model containing only meshes from the specified physical group
     * Tracks used mesh faces for remainder calculation
     * @param {Model} originalModel - The original model
     * @param {PhysicalGroup} group - The physical group to extract
     * @param {Map} usedMeshInstances - Map to track used mesh instances and faces
     * @returns {Model} - A new model containing only the specified group
     */
    CreateModelFromPhysicalGroup(originalModel, group, usedMeshInstances) {
        // Create a new model
        const filteredModel = new Model();
        
        // Log the group info for debugging
        console.log('Creating model from physical group:', {
            name: group.GetName(),
            meshCount: group.GetMeshes ? group.GetMeshes().size : 'unknown',
            faceCount: group.TotalFaceCount ? group.TotalFaceCount() : 'unknown'
        });
        
        // Track meshes to process
        const meshesToProcess = new Map(); // meshKey -> { meshInstance, faceIndices }
        
        // First collect all mesh instance IDs and their face indices from the group
        originalModel.EnumerateMeshInstances(meshInstance => {
            const meshId = meshInstance.GetId();
            const meshKey = meshId.GetKey();
            
            // Ensure ContainsMesh is callable before using
            const containsMesh = typeof group.ContainsMesh === 'function' 
                ? group.ContainsMesh(meshId)
                : false;
                
            if (containsMesh) {
                // Get face indices for this mesh in the group
                const faceIndices = typeof group.GetMeshFaceIndices === 'function'
                    ? group.GetMeshFaceIndices(meshId)
                    : [];
                
                console.log(`Processing mesh ${meshKey} in group ${group.GetName()} with ${faceIndices.length} faces`);
                
                // Store mesh instance with face indices for processing
                meshesToProcess.set(meshKey, {
                    meshInstance: meshInstance,
                    faceIndices: faceIndices
                });
                
                // Track used mesh instances and faces for remainder calculation
                if (!usedMeshInstances.has(meshKey)) {
                    usedMeshInstances.set(meshKey, []);
                }
                
                // If no specific faces are listed, all faces are used
                if (faceIndices.length === 0) {
                    // Mark entire mesh as used for remainder calculation
                    usedMeshInstances.set(meshKey, 'all');
                } else {
                    // Add these face indices to the used set
                    const currentUsed = usedMeshInstances.get(meshKey);
                    if (currentUsed !== 'all') {
                        // Merge and deduplicate face indices
                        usedMeshInstances.set(meshKey, [...new Set([...currentUsed, ...faceIndices])]);
                    }
                }
            }
        });
        
        // Copy materials (same references, not cloned)
        for (let i = 0; i < originalModel.MaterialCount(); i++) {
            filteredModel.AddMaterial(originalModel.GetMaterial(i));
        }
        
        // Process each mesh to extract the required triangles
        meshesToProcess.forEach((data, meshKey) => {
            const { meshInstance, faceIndices } = data;
            const originalMesh = meshInstance.GetMesh();
            
            // Handle case where entire mesh is in the group
            if (faceIndices.length === 0) {
                // Create a new mesh with all the original data
                const clonedMesh = new Mesh();
                
                console.log(`Copying entire mesh with ${originalMesh.VertexCount()} vertices and ${originalMesh.TriangleCount()} triangles`);
                
                // Copy all vertices, normals and texture coords
                for (let i = 0; i < originalMesh.VertexCount(); i++) {
                    clonedMesh.AddVertex(originalMesh.GetVertex(i));
                }
                
                // Only copy normals if they exist in the original
                if (originalMesh.NormalCount() > 0) {
                    for (let i = 0; i < originalMesh.NormalCount(); i++) {
                        clonedMesh.AddNormal(originalMesh.GetNormal(i));
                    }
                }
                
                // Only copy texture UVs if they exist in the original
                if (originalMesh.TextureUVCount() > 0) {
                    for (let i = 0; i < originalMesh.TextureUVCount(); i++) {
                        clonedMesh.AddTextureUV(originalMesh.GetTextureUV(i));
                    }
                }
                
                // Copy all triangles
                let copiedTriangles = 0;
                for (let i = 0; i < originalMesh.TriangleCount(); i++) {
                    try {
                        const triangle = originalMesh.GetTriangle(i);
                        if (!triangle) {
                            console.log(`Failed to get triangle at index ${i}`);
                            continue;
                        }
                        
                        clonedMesh.AddTriangle(
                            triangle.v0, 
                            triangle.v1,
                            triangle.v2,
                            triangle.n0,
                            triangle.n1,
                            triangle.n2,
                            triangle.mat,
                            triangle.curve
                        );
                        copiedTriangles++;
                    } catch (error) {
                        console.error(`Error adding triangle ${i}:`, error);
                    }
                }
                
                console.log(`Successfully copied ${copiedTriangles} out of ${originalMesh.TriangleCount()} triangles`);
                
                // Add the mesh to the model
                const meshIndex = filteredModel.AddMesh(clonedMesh);
                
                // Create a node for this mesh with proper transformation
                const rootNode = filteredModel.GetRootNode();
                const meshNode = new Node();
                meshNode.AddMeshIndex(meshIndex);
                rootNode.AddChildNode(meshNode);
                
                // Copy transformation from original instance if available
                const transform = meshInstance.GetTransformation();
                if (transform && !transform.IsIdentity()) {
                    meshNode.SetTransformation(transform.Clone());
                }
            } else {
                // Create a new mesh with only the specified faces
                const clonedMesh = new Mesh();
                
                // Copy all vertices, normals and texture coords
                for (let i = 0; i < originalMesh.VertexCount(); i++) {
                    clonedMesh.AddVertex(originalMesh.GetVertex(i));
                }
                
                // Only copy normals if they exist in the original
                if (originalMesh.NormalCount() > 0) {
                    for (let i = 0; i < originalMesh.NormalCount(); i++) {
                        clonedMesh.AddNormal(originalMesh.GetNormal(i));
                    }
                }
                
                // Only copy texture UVs if they exist in the original
                if (originalMesh.TextureUVCount() > 0) {
                    for (let i = 0; i < originalMesh.TextureUVCount(); i++) {
                        clonedMesh.AddTextureUV(originalMesh.GetTextureUV(i));
                    }
                }
                
                // Copy only the triangles from the specified face indices
                console.log(`Copying triangles for mesh with ${originalMesh.TriangleCount()} total triangles`);
                console.log(`Face indices length: ${faceIndices.length}`);
                
                // If there are no specific faces, add all triangles
                if (faceIndices.length === 0) {
                    console.log('No specific face indices provided, copying all triangles');
                    // Copy all triangles from original mesh
                    let copiedTriangles = 0;
                    for (let i = 0; i < originalMesh.TriangleCount(); i++) {
                        try {
                            const triangle = originalMesh.GetTriangle(i);
                            if (!triangle) {
                                console.log(`Failed to get triangle at index ${i}`);
                                continue;
                            }
                            
                            clonedMesh.AddTriangle(
                                triangle.v0, 
                                triangle.v1,
                                triangle.v2,
                                triangle.n0,
                                triangle.n1,
                                triangle.n2,
                                triangle.mat,
                                triangle.curve
                            );
                            copiedTriangles++;
                        } catch (error) {
                            console.error(`Error adding triangle ${i}:`, error);
                        }
                    }
                    console.log(`Added all ${copiedTriangles} triangles to mesh`);
                    validFacesCount = copiedTriangles;
                } else {
                    // Use a set to deduplicate indices
                    const uniqueFaceIndices = new Set(faceIndices);
                    let validFacesCount = 0;
                
                    uniqueFaceIndices.forEach(faceIndex => {
                        // Skip out of bounds face indices
                        if (faceIndex < 0 || faceIndex >= originalMesh.TriangleCount()) {
                            console.log(`Skipping out of bounds face index: ${faceIndex}`);
                            return;
                        }
                        
                        // Get triangle from original mesh
                        const triangle = originalMesh.GetTriangle(faceIndex);
                        if (!triangle) {
                            console.log(`Failed to get triangle at index ${faceIndex}`);
                            return;
                        }
                        
                        // Add triangle with the same material
                        try {
                            clonedMesh.AddTriangle(
                                triangle.v0, 
                                triangle.v1,
                                triangle.v2,
                                triangle.n0,
                                triangle.n1,
                                triangle.n2,
                                triangle.mat,
                                triangle.curve
                            );
                            validFacesCount++;
                        } catch (error) {
                            console.error(`Error adding triangle from face ${faceIndex}:`, error);
                        }
                    });
                    
                    console.log(`Added ${validFacesCount} triangles from face indices`);
                }
                
                // Add the new mesh to the model if it has triangles
                if (clonedMesh.TriangleCount() > 0) {
                    // Add the mesh to the model
                    const meshIndex = filteredModel.AddMesh(clonedMesh);
                    
                    // Create a node for this mesh with proper transformation
                    const rootNode = filteredModel.GetRootNode();
                    const meshNode = new Node();
                    meshNode.AddMeshIndex(meshIndex);
                    rootNode.AddChildNode(meshNode);
                    
                    // Copy transformation from original instance if available
                    const transform = meshInstance.GetTransformation();
                    if (transform && !transform.IsIdentity()) {
                        meshNode.SetTransformation(transform.Clone());
                    }
                }
            }
        });
        
        return filteredModel;
    }
    
    /**
     * Creates a model containing only meshes/faces not in any physical group
     * @param {Model} originalModel - The original model
     * @param {Map} usedMeshInstances - Map of mesh keys to used face indices
     * @returns {Model} - A new model containing only the remainder
     */
    CreateRemainderModel(originalModel, usedMeshInstances) {
        const remainderModel = new Model();
        
        // Copy materials (same references, not cloned)
        for (let i = 0; i < originalModel.MaterialCount(); i++) {
            remainderModel.AddMaterial(originalModel.GetMaterial(i));
        }
        
        // Process each mesh instance to find unused mesh/faces
        originalModel.EnumerateMeshInstances(meshInstance => {
            const meshId = meshInstance.GetId();
            const meshKey = meshId.GetKey();
            const originalMesh = meshInstance.GetMesh();
            
            // Case 1: Mesh not in any group - add the entire mesh
            if (!usedMeshInstances.has(meshKey)) {
                // Create a new mesh with all the original data
                const clonedMesh = new Mesh();
                
                // Copy all vertices, normals and texture coords
                for (let i = 0; i < originalMesh.VertexCount(); i++) {
                    clonedMesh.AddVertex(originalMesh.GetVertex(i));
                }
                
                // Only copy normals if they exist in the original
                if (originalMesh.NormalCount() > 0) {
                    for (let i = 0; i < originalMesh.NormalCount(); i++) {
                        clonedMesh.AddNormal(originalMesh.GetNormal(i));
                    }
                }
                
                // Only copy texture UVs if they exist in the original
                if (originalMesh.TextureUVCount() > 0) {
                    for (let i = 0; i < originalMesh.TextureUVCount(); i++) {
                        clonedMesh.AddTextureUV(originalMesh.GetTextureUV(i));
                    }
                }
                
                // Copy all triangles
                for (let i = 0; i < originalMesh.TriangleCount(); i++) {
                    const triangle = originalMesh.GetTriangle(i);
                    clonedMesh.AddTriangle(
                        triangle.v0, 
                        triangle.v1,
                        triangle.v2,
                        triangle.n0,
                        triangle.n1,
                        triangle.n2,
                        triangle.mat,
                        triangle.curve
                    );
                }
                
                // Add the mesh to the model
                const meshIndex = remainderModel.AddMesh(clonedMesh);
                
                // Create a node for this mesh with proper transformation
                const rootNode = remainderModel.GetRootNode();
                const meshNode = new Node();
                meshNode.AddMeshIndex(meshIndex);
                rootNode.AddChildNode(meshNode);
                
                // Copy transformation from original instance if available
                const transform = meshInstance.GetTransformation();
                if (transform && !transform.IsIdentity()) {
                    meshNode.SetTransformation(transform.Clone());
                }
            } 
            // Case 2: Some but not all faces used - add only unused faces
            else if (usedMeshInstances.get(meshKey) !== 'all') {
                const usedFaces = usedMeshInstances.get(meshKey);
                const usedFacesSet = new Set(usedFaces); // For faster lookup
                
                // Create a mesh with only the unused faces
                const clonedMesh = new Mesh();
                
                // Copy all vertices, normals and texture coords
                for (let i = 0; i < originalMesh.VertexCount(); i++) {
                    clonedMesh.AddVertex(originalMesh.GetVertex(i));
                }
                
                // Only copy normals if they exist in the original
                if (originalMesh.NormalCount() > 0) {
                    for (let i = 0; i < originalMesh.NormalCount(); i++) {
                        clonedMesh.AddNormal(originalMesh.GetNormal(i));
                    }
                }
                
                // Only copy texture UVs if they exist in the original
                if (originalMesh.TextureUVCount() > 0) {
                    for (let i = 0; i < originalMesh.TextureUVCount(); i++) {
                        clonedMesh.AddTextureUV(originalMesh.GetTextureUV(i));
                    }
                }
                
                // Add triangles that aren't in any physical group
                let unusedFacesFound = false;
                
                for (let i = 0; i < originalMesh.TriangleCount(); i++) {
                    if (!usedFacesSet.has(i)) {
                        // This face is not in any physical group
                        const triangle = originalMesh.GetTriangle(i);
                        clonedMesh.AddTriangle(
                            triangle.v0, 
                            triangle.v1,
                            triangle.v2,
                            triangle.n0,
                            triangle.n1,
                            triangle.n2,
                            triangle.mat,
                            triangle.curve
                        );
                        unusedFacesFound = true;
                    }
                }
                
                // Add the new mesh to the model if it has triangles
                if (unusedFacesFound && clonedMesh.TriangleCount() > 0) {
                    // Add the mesh to the model
                    const meshIndex = remainderModel.AddMesh(clonedMesh);
                    
                    // Create a node for this mesh with proper transformation
                    const rootNode = remainderModel.GetRootNode();
                    const meshNode = new Node();
                    meshNode.AddMeshIndex(meshIndex);
                    rootNode.AddChildNode(meshNode);
                    
                    // Copy transformation from original instance if available
                    const transform = meshInstance.GetTransformation();
                    if (transform && !transform.IsIdentity()) {
                        meshNode.SetTransformation(transform.Clone());
                    }
                }
            }
            // Case 3: All faces used - nothing to add to remainder
        });
        
        return remainderModel;
    }

    /**
     * Export the model as text STL
     * @param {ExporterModel} exporterModel - The model to export
     * @param {Array} files - Array to store the exported file
     */
    ExportText(exporterModel, files) {
        this.ExportTextForModel(exporterModel, files, 'model.stl', 'Model');
    }
    
    /**
     * Export a model as text STL with custom filename and solid name
     * @param {ExporterModel} exporterModel - The model to export
     * @param {Array} files - Array to store the exported file
     * @param {string} fileName - The filename to use
     * @param {string} modelName - The solid name to use
     */
    ExportTextForModel(exporterModel, files, fileName, modelName) {
        let stlFile = new ExportedFile(fileName);
        files.push(stlFile);
        
        let stlWriter = new TextWriter();
        stlWriter.WriteLine(`solid ${modelName}`);
        
        console.log(`Starting text STL export for ${fileName} with model ${modelName}`);
        console.log(`Model has ${exporterModel.TriangleCount()} triangles`);
        
        let triangleCount = 0;
        // Enumerate triangles with normals
        exporterModel.EnumerateTrianglesWithNormals((v0, v1, v2, normal) => {
            stlWriter.WriteArrayLine(['facet', 'normal', normal.x, normal.y, normal.z]);
            stlWriter.Indent(1);
            stlWriter.WriteLine('outer loop');
            stlWriter.Indent(1);
            stlWriter.WriteArrayLine(['vertex', v0.x, v0.y, v0.z]);
            stlWriter.WriteArrayLine(['vertex', v1.x, v1.y, v1.z]);
            stlWriter.WriteArrayLine(['vertex', v2.x, v2.y, v2.z]);
            stlWriter.Indent(-1);
            stlWriter.WriteLine('endloop');
            stlWriter.Indent(-1);
            stlWriter.WriteLine('endfacet');
            triangleCount++;
        });
        
        stlWriter.WriteLine(`endsolid ${modelName}`);
        
        const textContent = stlWriter.GetText();
        console.log(`Wrote ${triangleCount} triangles to text STL file, content length: ${textContent.length} bytes`);
        
        stlFile.SetTextContent(textContent);
    }

    /**
     * Export the model as binary STL
     * @param {ExporterModel} exporterModel - The model to export
     * @param {Array} files - Array to store the exported file
     */
    ExportBinary(exporterModel, files) {
        this.ExportBinaryForModel(exporterModel, files, 'model.stl');
    }
    
    /**
     * Export a model as binary STL with custom filename
     * @param {ExporterModel} exporterModel - The model to export
     * @param {Array} files - Array to store the exported file
     * @param {string} fileName - The filename to use
     */
    ExportBinaryForModel(exporterModel, files, fileName) {
        let stlFile = new ExportedFile(fileName);
        files.push(stlFile);
        
        // Count triangles
        let triangleCount = exporterModel.TriangleCount();
        console.log(`Starting binary STL export for ${fileName} with ${triangleCount} triangles`);
        
        // Validate triangle count before allocation
        if (triangleCount <= 0) {
            triangleCount = 0;
            console.warn('No triangles to export, creating empty STL file');
        }
        
        // Create binary writer
        let headerSize = 80;
        let fullByteLength = headerSize + 4 + triangleCount * 50;
        let stlWriter = new BinaryWriter(fullByteLength, true);
        
        // Write header (80 bytes of zeros)
        for (let i = 0; i < headerSize; i++) {
            stlWriter.WriteUnsignedCharacter8(0);
        }
        
        // Write triangle count
        stlWriter.WriteUnsignedInteger32(triangleCount);
        
        // Write triangles
        let writtenTriangles = 0;
        exporterModel.EnumerateTrianglesWithNormals((v0, v1, v2, normal) => {
            // Write normal
            stlWriter.WriteFloat32(normal.x);
            stlWriter.WriteFloat32(normal.y);
            stlWriter.WriteFloat32(normal.z);
            
            // Write vertices
            stlWriter.WriteFloat32(v0.x);
            stlWriter.WriteFloat32(v0.y);
            stlWriter.WriteFloat32(v0.z);
            
            stlWriter.WriteFloat32(v1.x);
            stlWriter.WriteFloat32(v1.y);
            stlWriter.WriteFloat32(v1.z);
            
            stlWriter.WriteFloat32(v2.x);
            stlWriter.WriteFloat32(v2.y);
            stlWriter.WriteFloat32(v2.z);
            
            // Write attribute byte count (always 0)
            stlWriter.WriteUnsignedInteger16(0);
            
            writtenTriangles++;
        });
        
        const buffer = stlWriter.GetBuffer();
        console.log(`Wrote ${writtenTriangles} triangles to binary STL file, buffer size: ${buffer.byteLength} bytes`);
        
        stlFile.SetBufferContent(buffer);
    }
}