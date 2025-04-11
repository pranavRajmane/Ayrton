import { ArrayBufferToUtf8String, Utf8StringToArrayBuffer } from '../io/bufferutils.js';
import { Loc } from '../core/localization.js';

export class ExportedFile
{
	constructor (name)
	{
		this.name = name;
		this.content = null;
	}

	GetName ()
	{
		return this.name;
	}

	SetName (name)
	{
		this.name = name;
	}

	GetTextContent ()
	{
		let text = ArrayBufferToUtf8String (this.content);
		return text;
	}

	GetBufferContent ()
	{
		return this.content;
	}

	SetTextContent (content)
	{
		console.log(`Setting text content, length: ${content.length}`);
		// Ensure there is content to set
		if (!content || content.length === 0) {
			console.warn('Empty content passed to SetTextContent!');
			content = ' '; // Add a space to ensure it's not empty
		}
		let buffer = Utf8StringToArrayBuffer (content);
		console.log(`Created buffer of length: ${buffer.byteLength}`);
		this.content = buffer;
	}

	SetBufferContent (content)
	{
		console.log(`Setting buffer content, byteLength: ${content.byteLength || 'unknown'}`);
		// Ensure there is content to set
		if (!content || (content.byteLength !== undefined && content.byteLength === 0)) {
			console.warn('Empty buffer passed to SetBufferContent!');
			// Create a minimal valid buffer with a single byte
			content = new Uint8Array([32]).buffer;
		}
		this.content = content;
	}
}

export class ExporterBase
{
    constructor ()
    {

    }

    CanExport (format, extension)
    {
        return false;
    }

	Export (exporterModel, format, onFinish)
	{
		let files = [];
		// Clone settings to ensure they're properly passed to the exporter
		if (exporterModel.settings) {
			console.log('Exporting with settings:', JSON.stringify(exporterModel.settings));
		}
		this.ExportContent (exporterModel, format, files, () => {
			onFinish (files);
		});
	}

	ExportContent (exporterModel, format, files, onFinish)
	{

	}

	GetExportedMaterialName (originalName)
	{
		return this.GetExportedName (originalName, Loc ('Material'));
	}

	GetExportedMeshName (originalName)
	{
		return this.GetExportedName (originalName, Loc ('Mesh'));
	}

	GetExportedName (originalName, defaultName)
	{
		if (originalName.length === 0) {
			return defaultName;
		}
		return originalName;
	}
}
