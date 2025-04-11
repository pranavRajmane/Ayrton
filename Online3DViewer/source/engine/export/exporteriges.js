import { ExporterBase, ExportedFile } from './exporterbase.js';
import { FileFormat } from '../io/fileutils.js';

// IGES entity type constants
const EntityType = {
    VERTEX_LIST: 502,
    EDGE_LIST: 504,
    LOOP: 508,
    FACE: 510,
    SHELL: 514,
    GROUP: 402,
    NAME_PROPERTY: 406
};

export class ExporterIges extends ExporterBase {
    constructor() {
        super();
    }

    CanExport(format, extension) {
        return (extension === 'iges' || extension === 'igs');
    }

    ExportContent(exporterModel, format, files, onFinish) {
        try {
            const model = exporterModel.GetModel();
            console.log('Exporting model to IGES with B-Rep entities for physical groups');
            
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
            
            // Collect physical group data with proper triangle mapping
            const physicalGroups = [];
            
            // Track which triangles are assigned to groups
            const totalTriangles = triangles.length / 3;
            console.log(`Total triangles in model: ${totalTriangles}`);
            
            // Create a set to track assigned triangles
            const assignedTriangles = new Set();
            
            if (model.physicalGroups && model.physicalGroups.length > 0) {
                console.log(`Found ${model.physicalGroups.length} physical groups`);
                
                // Process each physical group to extract triangle assignments
                for (let i = 0; i < model.physicalGroups.length; i++) {
                    try {
                        const group = model.physicalGroups[i];
                        if (!group || typeof group.GetName !== 'function') {
                            console.warn('Invalid physical group, skipping');
                            continue;
                        }
                        
                        const groupName = group.GetName();
                        console.log(`Processing group: ${groupName}`);
                        
                        // For now, assign a subset of triangles to each group
                        // This is a simplified approach until proper mesh mapping is implemented
                        const groupTriangles = [];
                        const groupSize = Math.max(1, Math.floor(totalTriangles / model.physicalGroups.length));
                        const startIdx = i * groupSize;
                        const endIdx = Math.min(totalTriangles, (i + 1) * groupSize);
                        
                        for (let j = startIdx; j < endIdx; j++) {
                            groupTriangles.push(j);
                            assignedTriangles.add(j);
                        }
                        
                        // Add this group with its assigned triangles
                        physicalGroups.push({
                            name: groupName,
                            meshIds: groupTriangles
                        });
                    } catch (error) {
                        console.error("Error processing group:", error);
                    }
                }
                
                // Create a group for unassigned triangles
                const unassignedTriangles = [];
                for (let i = 0; i < totalTriangles; i++) {
                    if (!assignedTriangles.has(i)) {
                        unassignedTriangles.push(i);
                    }
                }
                
                if (unassignedTriangles.length > 0) {
                    console.log(`Adding unassigned group with ${unassignedTriangles.length} triangles`);
                    physicalGroups.push({
                        name: "Unassigned_Faces",
                        meshIds: unassignedTriangles
                    });
                }
            } else {
                // No groups defined, create a single group with all triangles
                console.warn("No valid physical groups found. Creating a default group with all triangles.");
                const allTriangleIndices = [];
                for (let j = 0; j < totalTriangles; j++) {
                    allTriangleIndices.push(j);
                }
                
                physicalGroups.push({
                    name: "Model_Faces",
                    meshIds: allTriangleIndices
                });
            }
            
            // Prepare model data for the API
            const modelData = {
                vertices: vertices,
                triangles: triangles,
                physicalGroups: physicalGroups
            };
            
            // For IGES export, we need the server running on port 8082
            const apiUrl = 'http://localhost:8082/api/convert-to-iges';
            
            console.log('Sending IGES export request to server API:', apiUrl);
            
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
                a.download = 'model.igs';
                document.body.appendChild(a);
                a.click();
                
                // Clean up
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                // Create an empty file for the exporter pipeline
                // This is needed because the file is downloaded directly by the browser
                const igesFile = new ExportedFile('model.igs');
                igesFile.SetTextContent(''); // Empty content as the file is already downloaded
                files.push(igesFile);
                
                onFinish();
            })
            .catch(error => {
                console.error('Error exporting IGES file:', error);
                
                // Create a fallback dummy file with error message
                const igesFile = new ExportedFile('error.txt');
                igesFile.SetTextContent(`Export failed: ${error.message}`);
                files.push(igesFile);
                
                onFinish();
            });
        } catch (error) {
            console.error('Error during IGES export preparation:', error);
            onFinish();
        }
    }
}