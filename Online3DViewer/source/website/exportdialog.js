import { RunTaskAsync } from '../engine/core/taskrunner.js';
import { Coord3D } from '../engine/geometry/coord3d.js';
import { Matrix } from '../engine/geometry/matrix.js';
import { FileFormat } from '../engine/io/fileutils.js';
import { Exporter } from '../engine/export/exporter.js';
import { ExporterModel, ExporterSettings } from '../engine/export/exportermodel.js';
import { AddDiv, ClearDomElement } from '../engine/viewer/domutils.js';
import { AddSelect } from '../website/utils.js';
import { ButtonDialog, ProgressDialog } from './dialog.js';
import { ShowMessageDialog } from './dialogs.js';
import { DownloadArrayBufferAsFile } from './utils.js';
import { CookieGetStringVal, CookieSetStringVal } from './cookiehandler.js';
import { HandleEvent } from './eventhandler.js';
import { Loc } from '../engine/core/localization.js';

import * as fflate from 'fflate';

function AddSelectWithCookieSave (parentElement, cookieKey, options, defaultSelectedIndex, onChange)
{
    let previousOption = CookieGetStringVal (cookieKey, null);
    let previousOptionIndex = options.indexOf (previousOption);
    let selectedIndex = (previousOptionIndex !== -1 ? previousOptionIndex : defaultSelectedIndex);
    return AddSelect (parentElement, options, selectedIndex, (newSelectedIndex) => {
        CookieSetStringVal (cookieKey, options[newSelectedIndex]);
        if (onChange) {
            onChange (newSelectedIndex);
        }
    });
}

class ModelExporterUI
{
    constructor (name, format, extension)
    {
        this.name = name;
        this.format = format;
        this.extension = extension;
        this.visibleOnlySelect = null;
        this.rotationSelect = null;
    }

    GetName ()
    {
        return this.name;
    }

    GenerateParametersUI (parametersDiv, model)
    {
        function AddSelectItem (parametersDiv, name, cookieKey, values, defaultIndex)
        {
            let parameterRow = AddDiv (parametersDiv, 'ov_dialog_row');
            AddDiv (parameterRow, 'ov_dialog_row_name', name);
            let parameterValueDiv = AddDiv (parameterRow, 'ov_dialog_row_value');
            return AddSelectWithCookieSave (parameterValueDiv, cookieKey, values, defaultIndex);
        }
        
        function AddCheckboxItem (parametersDiv, name, cookieKey, defaultValue, onChange)
        {
            let parameterRow = AddDiv (parametersDiv, 'ov_dialog_row');
            AddDiv (parameterRow, 'ov_dialog_row_name', name);
            let parameterValueDiv = AddDiv (parameterRow, 'ov_dialog_row_value');
            
            // Create checkbox
            let checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'ov_dialog_checkbox';
            
            // Initialize from cookie if available, otherwise use default value
            let storedValue = CookieGetStringVal(cookieKey, null);
            checkbox.checked = storedValue !== null ? (storedValue === 'true') : defaultValue;
            
            // Set up event handler
            checkbox.addEventListener('change', () => {
                CookieSetStringVal(cookieKey, checkbox.checked.toString());
                if (onChange) {
                    onChange(checkbox.checked);
                }
            });
            
            parameterValueDiv.appendChild(checkbox);
            return checkbox;
        }

        // Store the model for later use
        this.model = model;

        this.visibleOnlySelect = AddSelectItem (parametersDiv, Loc ('Scope'), 'ov_last_scope', [Loc ('Entire Model'), Loc ('Visible Only')], 1);
        this.rotationSelect = AddSelectItem (parametersDiv, Loc ('Rotation'), 'ov_last_rotation', [Loc ('No Rotation'), Loc ('-90 Degrees'), Loc ('90 Degrees')], 0);
        
        // Add physical group export options
        this.physicalGroupCheckbox = null;
        this.remainderCheckbox = null;
        this.physicalGroupsDiv = null;
        
        // Check if the model has physical groups
        const hasPhysicalGroups = this.model && this.model.physicalGroups && this.model.physicalGroups.length > 0;
        
        if (hasPhysicalGroups) {
            // Add separator
            let separator = AddDiv(parametersDiv, 'ov_dialog_separator');
            separator.style.marginTop = '10px';
            separator.style.marginBottom = '10px';
            
            // Add physical groups export options
            this.physicalGroupCheckbox = AddCheckboxItem(parametersDiv, Loc('Export Physical Groups Separately'), 'ov_export_physical_groups', false, (isChecked) => {
                // Show/hide the physical groups list and the remainder option
                if (this.physicalGroupsDiv) {
                    this.physicalGroupsDiv.style.display = isChecked ? 'block' : 'none';
                }
            });
            
            // Add option to export remainder
            this.remainderCheckbox = AddCheckboxItem(parametersDiv, Loc('Export Remainder (parts not in groups)'), 'ov_export_remainder', true);
            
            // Create a div for physical group selection
            this.physicalGroupsDiv = AddDiv(parametersDiv, 'ov_dialog_physical_groups');
            this.physicalGroupsDiv.style.display = this.physicalGroupCheckbox.checked ? 'block' : 'none';
            this.physicalGroupsDiv.style.marginTop = '10px';
            this.physicalGroupsDiv.style.maxHeight = '200px';
            this.physicalGroupsDiv.style.overflowY = 'auto';
            this.physicalGroupsDiv.style.border = '1px solid #ddd';
            this.physicalGroupsDiv.style.padding = '5px';
            
            // Add "Select All" checkbox
            let selectAllRow = AddDiv(this.physicalGroupsDiv, 'ov_dialog_row');
            let selectAllCheckbox = document.createElement('input');
            selectAllCheckbox.type = 'checkbox';
            selectAllCheckbox.checked = true;
            selectAllCheckbox.style.marginRight = '5px';
            
            let selectAllLabel = document.createElement('label');
            selectAllLabel.style.fontWeight = 'bold';
            selectAllLabel.appendChild(selectAllCheckbox);
            selectAllLabel.appendChild(document.createTextNode(Loc('Select All')));
            selectAllRow.appendChild(selectAllLabel);
            
            // Add checkboxes for each physical group
            this.groupCheckboxes = [];
            for (let i = 0; i < this.model.physicalGroups.length; i++) {
                const group = this.model.physicalGroups[i];
                const groupName = group.GetName();
                
                let groupRow = AddDiv(this.physicalGroupsDiv, 'ov_dialog_row');
                let groupCheckbox = document.createElement('input');
                groupCheckbox.type = 'checkbox';
                groupCheckbox.checked = true;
                groupCheckbox.dataset.groupIndex = i;
                groupCheckbox.style.marginRight = '5px';
                
                let groupLabel = document.createElement('label');
                groupLabel.appendChild(groupCheckbox);
                groupLabel.appendChild(document.createTextNode(groupName));
                groupRow.appendChild(groupLabel);
                
                this.groupCheckboxes.push(groupCheckbox);
            }
            
            // Set up select all behavior
            selectAllCheckbox.addEventListener('change', () => {
                for (let checkbox of this.groupCheckboxes) {
                    checkbox.checked = selectAllCheckbox.checked;
                }
            });
            
            // Update select all checkbox when individual checkboxes change
            for (let checkbox of this.groupCheckboxes) {
                checkbox.addEventListener('change', () => {
                    const allChecked = this.groupCheckboxes.every(cb => cb.checked);
                    const noneChecked = this.groupCheckboxes.every(cb => !cb.checked);
                    
                    selectAllCheckbox.checked = allChecked;
                    selectAllCheckbox.indeterminate = !allChecked && !noneChecked;
                });
            }
        }
    }
    
    SetModel(model) {
        this.model = model;
    }

    ExportModel (model, callbacks)
    {
        // Create the export settings
        let settings = new ExporterSettings ();
        
        // Ensure exportPhysicalGroups always has a proper boolean value
        settings.exportPhysicalGroups = false;
        
        // Set visibility settings
        if (this.visibleOnlySelect.selectedIndex === 1) {
            settings.isMeshVisible = (meshInstanceId) => {
                return callbacks.isMeshVisible (meshInstanceId);
            };
        }

        // Set rotation settings
        if (this.rotationSelect.selectedIndex === 1) {
            let matrix = new Matrix ().CreateRotationAxisAngle (new Coord3D (1.0, 0.0, 0.0), -Math.PI / 2.0);
            settings.transformation.SetMatrix (matrix);
        } else if (this.rotationSelect.selectedIndex === 2) {
            let matrix = new Matrix ().CreateRotationAxisAngle (new Coord3D (1.0, 0.0, 0.0), Math.PI / 2.0);
            settings.transformation.SetMatrix (matrix);
        }
        
        // Handle physical groups export
        if (this.physicalGroupCheckbox && this.physicalGroupCheckbox.checked) {
            // Enable physical group export
            settings.exportPhysicalGroups = true;
            settings.exportSelectedOnly = true; // Ensure we only export selected groups
            
            // Set remainder export option
            if (this.remainderCheckbox) {
                settings.exportRemainder = this.remainderCheckbox.checked;
            }
            
            // Get the selected physical groups
            if (this.groupCheckboxes && this.groupCheckboxes.length > 0) {
                const selectedGroups = [];
                
                for (let i = 0; i < this.groupCheckboxes.length; i++) {
                    if (this.groupCheckboxes[i].checked) {
                        selectedGroups.push(parseInt(this.groupCheckboxes[i].dataset.groupIndex));
                    }
                }
                
                // If no groups are selected, show an error and exit
                if (selectedGroups.length === 0) {
                    ShowMessageDialog (
                        Loc ('Export Failed'),
                        Loc ('Please select at least one physical group to export.'),
                        null
                    );
                    return;
                }
                
                settings.selectedGroups = selectedGroups;
                settings.exportSeparateFiles = true;
                console.log('Exporting with physical groups:', {
                    exportPhysicalGroups: true,
                    selectedGroups,
                    exportRemainder: settings.exportRemainder,
                    exportSeparateFiles: true
                });
            }
        }

        // Create the exporter model
        let exporterModel = new ExporterModel (model, settings);
        
        // Validate that we have something to export
        if (exporterModel.MeshInstanceCount() === 0 && 
            (!model.physicalGroups || model.physicalGroups.length === 0)) {
            ShowMessageDialog (
                Loc ('Export Failed'),
                Loc ('The model doesn\'t contain any meshes or physical groups.'),
                null
            );
            return;
        }

        // Show progress dialog
        let progressDialog = new ProgressDialog ();
        progressDialog.Init (Loc ('Exporting Model'));
        progressDialog.Open ();

        // Run the export process asynchronously
        RunTaskAsync (() => {
            let exporter = new Exporter ();
            
            // Export the model
            exporter.Export (model, settings, this.format, this.extension, {
                onError : () => {
                    progressDialog.Close ();
                },
                onSuccess : (files) => {
                    if (files.length === 0) {
                        progressDialog.Close ();
                    } else if (files.length === 1) {
                        progressDialog.Close ();
                        let file = files[0];
                        DownloadArrayBufferAsFile (file.GetBufferContent (), file.GetName ());
                    } else if (files.length > 1) {
                        // Create zip file for multiple output files
                        let filesInZip = {};
                        for (let file of files) {
                            filesInZip[file.GetName()] = new Uint8Array (file.GetBufferContent());
                        }
                        let zippedContent = fflate.zipSync (filesInZip);
                        let zippedBuffer = zippedContent.buffer;
                        progressDialog.Close ();
                        DownloadArrayBufferAsFile (zippedBuffer, 'model.zip');
                    }
                }
            });
        });
    }
}

class ExportDialog
{
    constructor (callbacks)
    {
        this.callbacks = callbacks;
        this.selectedExporter = null;
        this.parametersDiv = null;

        this.exporters = [
            new ModelExporterUI ('Wavefront (.obj)', FileFormat.Text, 'obj'),
            new ModelExporterUI ('Stereolithography Text (.stl)', FileFormat.Text, 'stl'),
            new ModelExporterUI ('Stereolithography Binary (.stl)', FileFormat.Binary, 'stl'),
            new ModelExporterUI ('Polygon File Format Text (.ply)', FileFormat.Text, 'ply'),
            new ModelExporterUI ('Polygon File Format Binary (.ply)', FileFormat.Binary, 'ply'),
            new ModelExporterUI ('glTF Text (.gltf)', FileFormat.Text, 'gltf'),
            new ModelExporterUI ('glTF Binary (.glb)', FileFormat.Binary, 'glb'),
            new ModelExporterUI ('Object File Format Text (.off)', FileFormat.Text, 'off'),
            new ModelExporterUI ('Rhinoceros 3D (.3dm)', FileFormat.Binary, '3dm'),
            new ModelExporterUI ('Dotbim (.bim)', FileFormat.Text, 'bim'),
            new ModelExporterUI ('IGES with Physical Groups (.igs)', FileFormat.Text, 'igs'),
            new ModelExporterUI ('STEP with Physical Groups (.stp)', FileFormat.Text, 'stp')
        ];
    }

    Open (model, viewer)
    {
        // Store the model reference for all UI components to use
        this.model = model;
        
        let mainDialog = new ButtonDialog ();
        let contentDiv = mainDialog.Init (Loc ('Export'), [
            {
                name : Loc ('Close'),
                subClass : 'outline',
                onClick () {
                    mainDialog.Close ();
                }
            },
            {
                name : Loc ('Export'),
                onClick : () => {
                    mainDialog.Close ();
                    this.ExportFormat (model, viewer);
                }
            }
        ]);

        let text = Loc ('Select the format from the list below, and adjust the settings of the selected format.');
        AddDiv (contentDiv, 'ov_dialog_section', text);

        let formatRow = AddDiv (contentDiv, 'ov_dialog_row');
        this.parametersDiv = AddDiv (contentDiv);
        let formatNames = this.exporters.map (exporter => exporter.GetName ());
        let formatSelector = AddSelectWithCookieSave (formatRow, 'ov_last_export_format', formatNames, 6, (selectedIndex) => {
            this.OnFormatSelected (selectedIndex);
        });
        this.OnFormatSelected (formatSelector.selectedIndex);

        mainDialog.Open ();
    }

    OnFormatSelected (selectedIndex)
    {
        ClearDomElement (this.parametersDiv);
        this.selectedExporter = this.exporters[selectedIndex];
        this.selectedExporter.GenerateParametersUI (this.parametersDiv, this.model);
    }

    ExportFormat (model, viewer)
    {
        this.selectedExporter.ExportModel (model, {
            isMeshVisible : (meshInstanceId) => {
                return this.callbacks.isMeshVisible (meshInstanceId);
            }
        });
        HandleEvent ('model_exported', this.selectedExporter.GetName ());
    }
}

export function ShowExportDialog (model, viewer, callbacks)
{
    let exportDialog = new ExportDialog (callbacks);
    exportDialog.Open (model, viewer);
}

export function DownloadModel (importer)
{
    let fileList = importer.GetFileList ().GetFiles ();
    if (fileList.length === 0) {
        return;
    } else if (fileList.length === 1) {
        let file = fileList[0];
        DownloadArrayBufferAsFile (file.content, file.name);
    } else {
        let filesInZip = {};
        for (let file of fileList) {
            // Make sure we're creating a Uint8Array from the buffer
            let content = file.content;
            if (!(content instanceof Uint8Array)) {
                content = new Uint8Array(content);
            }
            filesInZip[file.name] = content;
        }
        let zippedContent = fflate.zipSync (filesInZip);
        DownloadArrayBufferAsFile (zippedContent.buffer, 'model.zip');
    }
}
