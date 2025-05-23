import { BinaryWriter } from '../io/binarywriter.js';
import { Utf8StringToArrayBuffer } from '../io/bufferutils.js';
import { FileFormat, GetFileExtension, GetFileName } from '../io/fileutils.js';
import { MeshInstanceId } from '../model/meshinstance.js';
import { RGBColor, SRGBToLinear } from '../model/color.js';
import { MaterialType } from '../model/material.js';
import { ConvertMeshToMeshBuffer } from '../model/meshbuffer.js';
import { ExportedFile, ExporterBase } from './exporterbase.js';

const GltfComponentType =
{
    UNSIGNED_INT : 5125,
    FLOAT : 5126
};

const GltfBufferType =
{
    ARRAY_BUFFER : 34962,
    ELEMENT_ARRAY_BUFFER : 34963
};

export class ExporterGltf extends ExporterBase
{
	constructor ()
	{
		super ();
        this.components = {
            index : {
                type : GltfComponentType.UNSIGNED_INT,
                size : 4
            },
            number : {
                type : GltfComponentType.FLOAT,
                size : 4
            }
        };
	}

    CanExport (format, extension)
    {
        return (format === FileFormat.Text && extension === 'gltf') || (format === FileFormat.Binary && extension === 'glb');
    }

	ExportContent (exporterModel, format, files, onFinish)
	{
        // Check if we need to handle physical group export
        if (exporterModel.settings && exporterModel.settings.exportPhysicalGroups) {
            console.log('Exporting physical groups to GLB format');
            
            // Extract settings for easier access
            const model = exporterModel.GetModel();
            const settings = exporterModel.settings;
            
            // Get selected groups or all groups if none specified
            let groupsToExport = [];
            if (settings.selectedGroups && settings.selectedGroups.length > 0) {
                groupsToExport = settings.selectedGroups;
                console.log('Selected groups to export:', groupsToExport);
            } else {
                // Export all groups
                for (let i = 0; i < model.PhysicalGroupCount(); i++) {
                    groupsToExport.push(i);
                }
                console.log('Exporting all groups:', groupsToExport.length);
            }
            
            // Export each physical group as a separate file
            for (const groupIndex of groupsToExport) {
                if (groupIndex < 0 || groupIndex >= model.PhysicalGroupCount()) {
                    console.warn(`Invalid physical group index: ${groupIndex}`);
                    continue;
                }
                
                const group = model.GetPhysicalGroup(groupIndex);
                if (!group) {
                    console.warn(`Could not get physical group at index ${groupIndex}`);
                    continue;
                }
                
                // Create a filtered model for this group
                const groupName = group.GetName() || `Group_${groupIndex}`;
                console.log(`Creating filtered model for group: ${groupName}`);
                
                // Create a filter function that only shows meshes in this group
                const groupFilter = (meshInstanceId) => {
                    return group.ContainsMesh(meshInstanceId);
                };
                
                // Make a copy of the settings with the new filter
                const groupSettings = Object.assign({}, exporterModel.settings);
                groupSettings.isMeshVisible = groupFilter;
                groupSettings.exportPhysicalGroups = false; // Prevent recursion
                
                // Create a new exporter model with the filtered settings
                const groupExporterModel = new exporterModel.constructor(model, groupSettings);
                
                // Generate a sanitized filename
                const sanitizedName = groupName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                const fileName = `${sanitizedName}.glb`;
                
                // Export this group
                if (format === FileFormat.Text) {
                    // For GLB we use binary format, but handle text just in case
                    const groupFiles = [];
                    this.ExportAsciiContent(groupExporterModel, groupFiles);
                    
                    // Rename the file to include group name
                    if (groupFiles.length > 0) {
                        const mainFile = groupFiles[0];
                        mainFile.SetName(fileName.replace('.glb', '.gltf'));
                        files.push(mainFile);
                        
                        // Add any additional files (like textures, bin files)
                        for (let i = 1; i < groupFiles.length; i++) {
                            files.push(groupFiles[i]);
                        }
                    }
                } else if (format === FileFormat.Binary) {
                    const groupFiles = [];
                    this.ExportBinaryContent(groupExporterModel, groupFiles);
                    
                    // Rename and add the file
                    if (groupFiles.length > 0) {
                        const mainFile = groupFiles[0];
                        mainFile.SetName(fileName);
                        files.push(mainFile);
                    }
                }
            }
            
            // Also export remainder if needed (meshes not in any group)
            if (settings.exportRemainder) {
                // TODO: Implement exporting remainder meshes
            }
            
            onFinish();
            return;
        }
        
        // Standard export without physical groups
        if (format === FileFormat.Text) {
            this.ExportAsciiContent (exporterModel, files);
        } else if (format === FileFormat.Binary) {
            this.ExportBinaryContent (exporterModel, files);
        }
        onFinish ();
	}

	ExportAsciiContent (exporterModel, files)
	{
        let gltfFile = new ExportedFile ('model.gltf');
        let binFile = new ExportedFile ('model.bin');
        files.push (gltfFile);
        files.push (binFile);

        let meshDataArr = this.GetMeshData (exporterModel);
        let mainBuffer = this.GetMainBuffer (meshDataArr);
        let mainJson = this.GetMainJson (exporterModel, meshDataArr);
        mainJson.buffers.push ({
            uri : binFile.GetName (),
            byteLength : mainBuffer.byteLength
        });

        let fileNameToIndex = new Map ();
        this.ExportMaterials (exporterModel, mainJson, (texture) => {
            let fileName = GetFileName (texture.name);
            if (fileNameToIndex.has (fileName)) {
                return fileNameToIndex.get (fileName);
            } else {
                let textureFile = new ExportedFile (fileName);
                textureFile.SetBufferContent (texture.buffer);
                files.push (textureFile);

                let textureIndex = mainJson.textures.length;
                fileNameToIndex.set (fileName, textureIndex);

                mainJson.images.push ({
                    uri : fileName
                });

                mainJson.textures.push ({
                    source : textureIndex
                });

                return textureIndex;
            }
        });

        gltfFile.SetTextContent (JSON.stringify (mainJson, null, 4));
        binFile.SetBufferContent (mainBuffer);
    }

    ExportBinaryContent (exporterModel, files)
    {
        function AlignToBoundary (size)
        {
            let remainder = size % 4;
            if (remainder === 0) {
                return size;
            }
            return size + (4 - remainder);
        }

        function WriteCharacters (writer, char, count)
        {
            for (let i = 0; i < count; i++) {
                writer.WriteUnsignedCharacter8 (char);
            }
        }

        let glbFile = new ExportedFile ('model.glb');
        files.push (glbFile);

        let meshDataArr = this.GetMeshData (exporterModel);
        let mainBuffer = this.GetMainBuffer (meshDataArr);
        let mainJson = this.GetMainJson (exporterModel, meshDataArr);

        let textureBuffers = [];
        let textureOffset = mainBuffer.byteLength;

        let fileNameToIndex = new Map ();
        this.ExportMaterials (exporterModel, mainJson, (texture) => {
            let fileName = GetFileName (texture.name);
            let extension = GetFileExtension (texture.name);
            if (fileNameToIndex.has (fileName)) {
                return fileNameToIndex.get (fileName);
            } else {
                let bufferViewIndex = mainJson.bufferViews.length;
                let textureIndex = mainJson.textures.length;
                fileNameToIndex.set (fileName, textureIndex);
                let textureBuffer = texture.buffer;
                textureBuffers.push (textureBuffer);
                mainJson.bufferViews.push ({
                    buffer : 0,
                    byteOffset : textureOffset,
                    byteLength : textureBuffer.byteLength
                });
                textureOffset += textureBuffer.byteLength;
                mainJson.images.push ({
                    bufferView : bufferViewIndex,
                    mimeType : 'image/' + extension
                });
                mainJson.textures.push ({
                    source : textureIndex
                });

                return textureIndex;
            }
        });

        let mainBinaryBufferLength = mainBuffer.byteLength;
        for (let i = 0; i < textureBuffers.length; i++) {
            let textureBuffer = textureBuffers[i];
            mainBinaryBufferLength += textureBuffer.byteLength;
        }
        let mainBinaryBufferAlignedLength = AlignToBoundary (mainBinaryBufferLength);
        mainJson.buffers.push ({
            byteLength : mainBinaryBufferAlignedLength
        });

        let mainJsonString = JSON.stringify (mainJson);
        let mainJsonBuffer = Utf8StringToArrayBuffer (mainJsonString);
        let mainJsonBufferLength = mainJsonBuffer.byteLength;
        let mainJsonBufferAlignedLength = AlignToBoundary (mainJsonBufferLength);

        let glbSize = 12 + 8 + mainJsonBufferAlignedLength + 8 + mainBinaryBufferAlignedLength;
        let glbWriter = new BinaryWriter (glbSize, true);

        glbWriter.WriteUnsignedInteger32 (0x46546C67);
        glbWriter.WriteUnsignedInteger32 (2);
        glbWriter.WriteUnsignedInteger32 (glbSize);

        glbWriter.WriteUnsignedInteger32 (mainJsonBufferAlignedLength);
        glbWriter.WriteUnsignedInteger32 (0x4E4F534A);
        glbWriter.WriteArrayBuffer (mainJsonBuffer);
        WriteCharacters (glbWriter, 32, mainJsonBufferAlignedLength - mainJsonBufferLength);

        glbWriter.WriteUnsignedInteger32 (mainBinaryBufferAlignedLength);
        glbWriter.WriteUnsignedInteger32 (0x004E4942);
        glbWriter.WriteArrayBuffer (mainBuffer);

        for (let i = 0; i < textureBuffers.length; i++) {
            let textureBuffer = textureBuffers[i];
            glbWriter.WriteArrayBuffer (textureBuffer);
        }
        WriteCharacters (glbWriter, 0, mainBinaryBufferAlignedLength - mainBinaryBufferLength);

        glbFile.SetBufferContent (glbWriter.GetBuffer ());
    }

    GetMeshData (exporterModel)
    {
        let meshDataArr = [];

        exporterModel.EnumerateMeshes ((mesh) => {
            let buffer = ConvertMeshToMeshBuffer (mesh);
            meshDataArr.push ({
                name : mesh.GetName (),
                buffer : buffer,
                offsets : [],
                sizes : []
            });
        });

        return meshDataArr;
    }

    GetMainBuffer (meshDataArr)
    {
        let mainBufferSize = 0;
        for (let meshData of meshDataArr) {
            mainBufferSize += meshData.buffer.GetByteLength (this.components.index.size, this.components.number.size);
        }

        let writer = new BinaryWriter (mainBufferSize, true);
        for (let meshData of meshDataArr) {
            for (let primitiveIndex = 0; primitiveIndex < meshData.buffer.PrimitiveCount (); primitiveIndex++) {
                let primitive = meshData.buffer.GetPrimitive (primitiveIndex);
                let offset = writer.GetPosition ();
                for (let i = 0; i < primitive.indices.length; i++) {
                    writer.WriteUnsignedInteger32 (primitive.indices[i]);
                }
                for (let i = 0; i < primitive.vertices.length; i++) {
                    writer.WriteFloat32 (primitive.vertices[i]);
                }
                for (let i = 0; i < primitive.colors.length; i++) {
                    writer.WriteFloat32 (SRGBToLinear (primitive.colors[i]));
                }
                for (let i = 0; i < primitive.normals.length; i++) {
                    writer.WriteFloat32 (primitive.normals[i]);
                }
                for (let i = 0; i < primitive.uvs.length; i++) {
                    let texCoord = primitive.uvs[i];
                    if (i % 2 === 1) {
                        texCoord *= -1.0;
                    }
                    writer.WriteFloat32 (texCoord);
                }
                meshData.offsets.push (offset);
                meshData.sizes.push (writer.GetPosition () - offset);
            }
        }

        return writer.GetBuffer ();
    }

    GetMainJson (exporterModel, meshDataArr)
    {
        class BufferViewCreator
        {
            constructor (mainJson, byteOffset)
            {
                this.mainJson = mainJson;
                this.byteOffset = byteOffset;
            }

            AddBufferView (byteLength, target)
            {
                let bufferView = {
                    buffer : 0,
                    byteOffset : this.byteOffset,
                    byteLength : byteLength,
                    target : target
                };
                this.mainJson.bufferViews.push (bufferView);
                this.byteOffset += byteLength;
                return this.mainJson.bufferViews.length - 1;
            }
        }

        function NodeHasVisibleChildren (model, node)
        {
            for (let meshIndex of node.GetMeshIndices ()) {
                let meshInstanceId = new MeshInstanceId (node.GetId (), meshIndex);
                if (model.IsMeshInstanceVisible (meshInstanceId)) {
                    return true;
                }
            }
            for (let childNode of node.GetChildNodes ()) {
                if (NodeHasVisibleChildren (model, childNode)) {
                    return true;
                }
            }
            return false;
        }

        function AddJsonNode (model, jsonParent, jsonNodes, node)
        {
            if (node.IsMeshNode ()) {
                for (let meshIndex of node.GetMeshIndices ()) {
                    AddMeshNode (model, jsonParent, jsonNodes, node, meshIndex, true);
                }
            } else if (NodeHasVisibleChildren (model, node)) {
                let nodeJson = {};

                let nodeName = node.GetName ();
                if (nodeName.length > 0) {
                    nodeJson.name = nodeName;
                }

                let transformation = node.GetTransformation ();
                if (!transformation.IsIdentity ()) {
                    nodeJson.matrix = node.GetTransformation ().GetMatrix ().Get ();
                }

                jsonNodes.push (nodeJson);
                jsonParent.push (jsonNodes.length - 1);

                nodeJson.children = [];
                AddChildNodes (model, nodeJson.children, jsonNodes, node);
            }
        }

        function AddMeshNode (model, jsonParent, jsonNodes, node, meshIndex, isStandaloneNode)
        {
            let meshInstanceId = new MeshInstanceId (node.GetId (), meshIndex);
            if (!model.IsMeshInstanceVisible (meshInstanceId)) {
                return;
            }

            let nodeJson = {
                mesh : model.MapMeshIndex (meshIndex)
            };
            if (isStandaloneNode) {
                let transformation = node.GetTransformation ();
                if (!transformation.IsIdentity ()) {
                    nodeJson.matrix = node.GetTransformation ().GetMatrix ().Get ();
                }
            }

            jsonNodes.push (nodeJson);
            jsonParent.push (jsonNodes.length - 1);
        }

        function AddChildNodes (model, jsonParent, jsonNodes, node)
        {
            for (let childNode of node.GetChildNodes ()) {
                AddJsonNode (model, jsonParent, jsonNodes, childNode);
            }
            for (let meshIndex of node.GetMeshIndices ()) {
                AddMeshNode (model, jsonParent, jsonNodes, node, meshIndex, false);
            }
        }

        let mainJson = {
            asset : {
                generator : 'https://3dviewer.net',
                version : '2.0'
            },
            scene : 0,
            scenes : [
                {
                    nodes : []
                }
            ],
            nodes : [],
            materials : [],
            meshes : [],
            buffers : [],
            bufferViews : [],
            accessors : []
        };

        let rootNode = exporterModel.GetModel ().GetRootNode ();
        AddChildNodes (exporterModel, mainJson.scenes[0].nodes, mainJson.nodes, rootNode);

        for (let meshData of meshDataArr) {
            let jsonMesh = {
                name : this.GetExportedMeshName (meshData.name),
                primitives : []
            };

            let primitives = meshData.buffer.primitives;
            for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex++) {
                let primitive = primitives[primitiveIndex];

                let bufferViewCreator = new BufferViewCreator (mainJson, meshData.offsets[primitiveIndex]);
                let indicesBufferView = bufferViewCreator.AddBufferView (primitive.indices.length * this.components.index.size, GltfBufferType.ELEMENT_ARRAY_BUFFER);
                let verticesBufferView = bufferViewCreator.AddBufferView (primitive.vertices.length * this.components.number.size, GltfBufferType.ARRAY_BUFFER);
                let colorsBufferView = null;
                if (primitive.colors.length > 0) {
                    colorsBufferView = bufferViewCreator.AddBufferView (primitive.colors.length * this.components.number.size, GltfBufferType.ARRAY_BUFFER);
                }
                let normalsBufferView = bufferViewCreator.AddBufferView (primitive.normals.length * this.components.number.size, GltfBufferType.ARRAY_BUFFER);
                let uvsBufferView = null;
                if (primitive.uvs.length > 0) {
                    uvsBufferView = bufferViewCreator.AddBufferView (primitive.uvs.length * this.components.number.size, GltfBufferType.ARRAY_BUFFER);
                }

                let jsonPrimitive = {
                    attributes : {},
                    mode : 4,
                    material : primitive.material
                };

                let bounds = primitive.GetBounds ();

                mainJson.accessors.push ({
                    bufferView : indicesBufferView,
                    byteOffset : 0,
                    componentType : this.components.index.type,
                    count : primitive.indices.length,
                    type : 'SCALAR'
                });
                jsonPrimitive.indices = mainJson.accessors.length - 1;

                mainJson.accessors.push ({
                    bufferView : verticesBufferView,
                    byteOffset : 0,
                    componentType : this.components.number.type,
                    count : primitive.vertices.length / 3,
                    min : bounds.min,
                    max : bounds.max,
                    type : 'VEC3'
                });
                jsonPrimitive.attributes.POSITION = mainJson.accessors.length - 1;

                if (colorsBufferView !== null) {
                    mainJson.accessors.push ({
                        bufferView : colorsBufferView,
                        byteOffset : 0,
                        componentType : this.components.number.type,
                        count : primitive.colors.length / 3,
                        type : 'VEC3'
                    });
                    jsonPrimitive.attributes.COLOR_0 = mainJson.accessors.length - 1;
                }

                mainJson.accessors.push ({
                    bufferView : normalsBufferView,
                    byteOffset : 0,
                    componentType : this.components.number.type,
                    count : primitive.normals.length / 3,
                    type : 'VEC3'
                });
                jsonPrimitive.attributes.NORMAL = mainJson.accessors.length - 1;

                if (uvsBufferView !== null) {
                    mainJson.accessors.push ({
                        bufferView : uvsBufferView,
                        byteOffset : 0,
                        componentType : this.components.number.type,
                        count : primitive.uvs.length / 2,
                        type : 'VEC2'
                    });
                    jsonPrimitive.attributes.TEXCOORD_0 = mainJson.accessors.length - 1;
                }

                jsonMesh.primitives.push (jsonPrimitive);
            }

            mainJson.meshes.push (jsonMesh);
        }

        return mainJson;
    }

    ExportMaterials (exporterModel, mainJson, addTexture)
    {
        function ExportMaterial (obj, mainJson, material, addTexture)
        {
            function ColorToRGBA (color, opacity)
            {
                return [
                    SRGBToLinear (color.r / 255.0),
                    SRGBToLinear (color.g / 255.0),
                    SRGBToLinear (color.b / 255.0),
                    opacity
                ];
            }

            function ColorToRGB (color)
            {
                return [
                    SRGBToLinear (color.r / 255.0),
                    SRGBToLinear (color.g / 255.0),
                    SRGBToLinear (color.b / 255.0)
                ];
            }

            function GetTextureParams (mainJson, texture, addTexture)
            {
                if (texture === null || !texture.IsValid ()) {
                    return null;
                }

                if (mainJson.images === undefined) {
                    mainJson.images = [];
                }
                if (mainJson.textures === undefined) {
                    mainJson.textures = [];
                }

                let textureIndex = addTexture (texture);
                let textureParams = {
                    index : textureIndex
                };

                if (texture.HasTransformation ()) {
                    let extensionName = 'KHR_texture_transform';
                    if (mainJson.extensionsUsed === undefined) {
                        mainJson.extensionsUsed = [];
                    }
                    if (mainJson.extensionsUsed.indexOf (extensionName) === -1) {
                        mainJson.extensionsUsed.push (extensionName);
                    }
                    textureParams.extensions = {
                        KHR_texture_transform : {
                            offset : [texture.offset.x, -texture.offset.y],
                            scale : [texture.scale.x, texture.scale.y],
                            rotation : -texture.rotation
                        }
                    };
                }

                return textureParams;
            }

            let jsonMaterial = {
                name : obj.GetExportedMaterialName (material.name),
                pbrMetallicRoughness : {
                    baseColorFactor : ColorToRGBA (material.color, material.opacity)
                },
                emissiveFactor : ColorToRGB (material.emissive),
                doubleSided : true,
                alphaMode : 'OPAQUE'
            };

            if (material.transparent) {
                // TODO: mask, alphaCutoff?
                jsonMaterial.alphaMode = 'BLEND';
            }

            let baseColorTexture = GetTextureParams (mainJson, material.diffuseMap, addTexture);
            if (baseColorTexture !== null) {
                if (!material.multiplyDiffuseMap) {
                    jsonMaterial.pbrMetallicRoughness.baseColorFactor = ColorToRGBA (new RGBColor (255, 255, 255), material.opacity);
                }
                jsonMaterial.pbrMetallicRoughness.baseColorTexture = baseColorTexture;
            }
            if (material.type === MaterialType.Physical) {
                let metallicTexture = GetTextureParams (mainJson, material.metalnessMap, addTexture);
                if (metallicTexture !== null) {
                    jsonMaterial.pbrMetallicRoughness.metallicRoughnessTexture = metallicTexture;
                } else {
                    jsonMaterial.pbrMetallicRoughness.metallicFactor = material.metalness;
                    jsonMaterial.pbrMetallicRoughness.roughnessFactor = material.roughness;
                }
            }
            let normalTexture = GetTextureParams (mainJson, material.normalMap, addTexture);
            if (normalTexture !== null) {
                jsonMaterial.normalTexture = normalTexture;
            }
            let emissiveTexture = GetTextureParams (mainJson, material.emissiveMap, addTexture);
            if (emissiveTexture !== null) {
                jsonMaterial.emissiveTexture = emissiveTexture;
            }

            mainJson.materials.push (jsonMaterial);
        }

        for (let materialIndex = 0; materialIndex < exporterModel.MaterialCount (); materialIndex++) {
            let material = exporterModel.GetMaterial (materialIndex);
            ExportMaterial (this, mainJson, material, addTexture);
        }
    }
    
}
