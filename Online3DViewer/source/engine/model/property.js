import { EscapeHtmlChars } from '../core/core.js';
import { RGBColorToHexString } from './color.js';
import { Loc } from '../core/localization.js';

export const PropertyType =
{
    Text : 1,
    Integer : 2,
    Number : 3,
    Boolean : 4,
    Percent : 5,
    Color : 6
};

export class Property
{
    constructor (type, name, value)
    {
        this.type = type;
        this.name = name;
        this.value = value;
    }

    Clone ()
    {
        const clonable = (this.type === PropertyType.Color);
        if (clonable) {
            return new Property (this.type, this.name, this.value.Clone ());
        } else {
            return new Property (this.type, this.name, this.value);
        }
    }
}

export class PropertyGroup
{
    constructor (name)
    {
        this.name = name;
        this.properties = [];
    }

    PropertyCount ()
    {
        return this.properties.length;
    }

    AddProperty (property)
    {
        this.properties.push (property);
    }

    GetProperty (index)
    {
        return this.properties[index];
    }

    Clone ()
    {
        let cloned = new PropertyGroup (this.name);
        for (let property of this.properties) {
            cloned.AddProperty (property.Clone ());
        }
        return cloned;
    }
}

export function PropertyToString (property)
{
    if (property.type === PropertyType.Text) {
        return EscapeHtmlChars (property.value);
    } else if (property.type === PropertyType.Integer) {
        return property.value.toLocaleString ();
    } else if (property.type === PropertyType.Number) {
        return property.value.toLocaleString (undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    } else if (property.type === PropertyType.Boolean) {
        return property.value ? Loc ('True') : Loc ('False');
    } else if (property.type === PropertyType.Percent) {
        return parseInt (property.value * 100, 10).toString () + '%';
    } else if (property.type === PropertyType.Color) {
        return '#' + RGBColorToHexString (property.value);
    }
    return null;
}

// Physical group for grouping entire meshes
export class PhysicalGroup
{
    constructor (name)
    {
        this.name = name;
        this.meshes = new Set(); // Store mesh IDs
        this.meshFaces = new Map(); // Map mesh ID keys to arrays of face indices
        this.color = null; // Optional color for the group
        
        // Make the internal structures more robust
        if (!this.meshes) this.meshes = new Set();
        if (!this.meshFaces) this.meshFaces = new Map();
    }
    
    GetName ()
    {
        return this.name;
    }
    
    SetName (name)
    {
        this.name = name;
        return this;
    }
    
    SetColor (color)
    {
        this.color = color;
        return this;
    }
    
    GetColor ()
    {
        return this.color;
    }
    
    AddMesh (meshInstanceId)
    {
        const meshKey = meshInstanceId.GetKey();
        this.meshes.add(meshKey);
        
        // Initialize the face array if not already present
        if (!this.meshFaces.has(meshKey)) {
            this.meshFaces.set(meshKey, []);
        }
        
        return this;
    }
    
    AddMeshWithIndex (meshInstanceId, faceIndex)
    {
        if (!meshInstanceId || typeof meshInstanceId.GetKey !== 'function') {
            console.error('Invalid meshInstanceId provided to AddMeshWithIndex');
            return this;
        }
        
        const meshKey = meshInstanceId.GetKey();
        this.meshes.add(meshKey);
        
        // Initialize the face array if not already present
        if (!this.meshFaces.has(meshKey)) {
            this.meshFaces.set(meshKey, []);
        }
        
        // Add the face index if not already present
        const faceIndices = this.meshFaces.get(meshKey);
        if (faceIndex !== undefined && !faceIndices.includes(faceIndex)) {
            faceIndices.push(faceIndex);
            console.log(`Added face index ${faceIndex} to mesh ${meshKey}, now has ${faceIndices.length} faces`);
        }
        
        return this;
    }
    
    RemoveMesh (meshInstanceId)
    {
        const meshKey = meshInstanceId.GetKey();
        this.meshes.delete(meshKey);
        this.meshFaces.delete(meshKey);
        return this;
    }
    
    ContainsMesh (meshInstanceId)
    {
        if (!meshInstanceId || typeof meshInstanceId.GetKey !== 'function') {
            console.error('Invalid meshInstanceId provided to ContainsMesh');
            return false;
        }
        return this.meshes.has(meshInstanceId.GetKey());
    }
    
    GetMeshes ()
    {
        return this.meshes;
    }
    
    GetMeshFaceIndices (meshInstanceId)
    {
        if (!meshInstanceId || typeof meshInstanceId.GetKey !== 'function') {
            console.error('Invalid meshInstanceId provided to GetMeshFaceIndices');
            return [];
        }
        const meshKey = meshInstanceId.GetKey();
        const faceIndices = this.meshFaces.get(meshKey) || [];
        console.log(`Getting face indices for mesh ${meshKey}: found ${faceIndices.length} faces`);
        return faceIndices;
    }
    
    MeshCount ()
    {
        return this.meshes.size;
    }
    
    TotalFaceCount ()
    {
        let count = 0;
        for (const faceArray of this.meshFaces.values()) {
            count += faceArray.length;
        }
        return count;
    }
    
    Clear ()
    {
        this.meshes.clear();
        this.meshFaces.clear();
        return this;
    }
}
