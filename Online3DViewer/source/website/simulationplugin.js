import { RegisterPlugin, PluginType } from './pluginregistry.js';
import { ExporterModel, ExporterSettings } from '../engine/export/exportermodel.js';
import { FileFormat } from '../engine/io/fileutils.js';
import { ExporterGltf } from '../engine/export/exportergltf.js';
import { Exporter } from '../engine/export/exporter.js';
import { Loc } from '../engine/core/localization.js';
import { AddDiv, ShowDomElement } from '../engine/viewer/domutils.js';
import { ShowMessageDialog } from './dialogs.js';
import { ButtonDialog } from './dialog.js';
import { AddSvgIconElement } from './utils.js';

/**
 * SimulationPlugin - A plugin that adds a "Simulate" button to the toolbar
 * which exports all physical groups as GLB files to the server.
 */
class SimulationPlugin {
    constructor() {
        this.physicalGroups = new Set();
        this.website = null;
        this.simulateButton = null;
        this.progressDialog = null;
        this.isExporting = false;
        this.serverEndpoint = '/api/upload-physical-group';
    }

    /**
     * Initializes the plugin by registering event listeners to track physical groups
     * @param {Object} website - The main website instance
     */
    initialize(website) {
        this.website = website;
        
        // Add the Simulate button
        this.addSimulateButton();
        
        // Listen for model events to track physical groups
        document.addEventListener('physical_group_created', this.handlePhysicalGroupCreated.bind(this));
        document.addEventListener('model_loaded', this.resetPhysicalGroups.bind(this));
    }

    /**
     * Adds the Simulate button to the toolbar
     */
    addSimulateButton() {
        // Find the toolbar element
        const toolbarDiv = document.querySelector('.ov_toolbar');
        if (!toolbarDiv) {
            console.error('Toolbar element not found');
            return;
        }

        // Create simulate button
        this.simulateButton = document.createElement('div');
        this.simulateButton.className = 'ov_toolbar_button only_on_model';
        this.simulateButton.title = Loc('Simulate Physical Groups');
        this.simulateButton.setAttribute('alt', Loc('Simulate Physical Groups'));
        
        // Add icon to button (using the snapshot icon for simulation)
        AddSvgIconElement(this.simulateButton, 'snapshot');
        
        // Add handler for button click
        this.simulateButton.addEventListener('click', this.handleSimulateClick.bind(this));
        
        // Add a separator first
        const separator = document.createElement('div');
        separator.className = 'ov_toolbar_separator only_on_model';
        
        // Insert the separator and button at the end of the toolbar
        toolbarDiv.appendChild(separator);
        toolbarDiv.appendChild(this.simulateButton);
        
        // Initially hide the button (will show when model is loaded)
        ShowDomElement(this.simulateButton, false);
    }

    /**
     * Handles the creation of a physical group
     * @param {Event} event - The physical group created event
     */
    handlePhysicalGroupCreated(event) {
        if (event.detail && event.detail.groupIndex !== undefined) {
            console.log(`SimulationPlugin: Tracked physical group ${event.detail.groupIndex}`);
            this.physicalGroups.add(event.detail.groupIndex);
            
            // Show the simulate button when we have physical groups
            if (this.simulateButton) {
                ShowDomElement(this.simulateButton, true);
            }
        }
    }

    /**
     * Resets the tracked physical groups when a new model is loaded
     */
    resetPhysicalGroups() {
        this.physicalGroups.clear();
        
        // Check if the newly loaded model has physical groups
        if (this.website && this.website.model && this.website.model.physicalGroups) {
            const groupCount = this.website.model.PhysicalGroupCount ? 
                this.website.model.PhysicalGroupCount() :
                (this.website.model.physicalGroups ? this.website.model.physicalGroups.length : 0);
                
            if (groupCount > 0) {
                // Add all existing groups
                for (let i = 0; i < groupCount; i++) {
                    this.physicalGroups.add(i);
                }
                
                // Show the simulate button
                if (this.simulateButton) {
                    ShowDomElement(this.simulateButton, true);
                }
            } else if (this.simulateButton) {
                ShowDomElement(this.simulateButton, false);
            }
        } else if (this.simulateButton) {
            ShowDomElement(this.simulateButton, false);
        }
    }

    /**
     * Handles the Simulate button click
     */
    handleSimulateClick() {
        if (this.isExporting) {
            return; // Prevent multiple simultaneous exports
        }
        
        // Check if we have any physical groups to export
        if (this.physicalGroups.size === 0) {
            ShowMessageDialog(
                Loc('No Physical Groups'),
                Loc('There are no physical groups to simulate. Please create physical groups first.'),
                null
            );
            return;
        }
        
        // Confirm before starting simulation
        const confirmDialog = new ButtonDialog();
        confirmDialog.Init(
            Loc('Confirm Simulation'),
            [
                {
                    name: Loc('Cancel'),
                    subClass: 'outline',
                    onClick: () => {
                        confirmDialog.Close();
                    }
                },
                {
                    name: Loc('Simulate'),
                    onClick: () => {
                        confirmDialog.Close();
                        this.startSimulation();
                    }
                }
            ]
        );
        
        // Add description text to dialog
        const contentDiv = confirmDialog.GetContentDiv();
        AddDiv(contentDiv, 'ov_dialog_section', 
            Loc(`This will export all ${this.physicalGroups.size} physical groups as GLB files and send them to the server for simulation.`)
        );
        
        confirmDialog.Open();
    }

    /**
     * Starts the simulation process
     */
    startSimulation() {
        this.isExporting = true;
        
        // Create progress dialog
        this.progressDialog = new ButtonDialog();
        this.progressDialog.Init(
            Loc('Simulating Physical Groups'),
            [
                {
                    name: Loc('Cancel'),
                    subClass: 'outline',
                    onClick: () => {
                        this.isExporting = false;
                        this.progressDialog.Close();
                    }
                }
            ]
        );
        
        // Add progress container
        const contentDiv = this.progressDialog.GetContentDiv();
        const progressContainer = AddDiv(contentDiv, 'ov_dialog_section');
        progressContainer.id = 'simulation_progress_container';
        
        // Add status text
        const statusDiv = AddDiv(progressContainer, 'ov_dialog_row');
        statusDiv.id = 'simulation_status';
        statusDiv.textContent = Loc('Preparing simulation...');
        
        // Add progress bar
        const progressBarContainer = AddDiv(progressContainer, 'ov_progress_bar_container');
        const progressBar = AddDiv(progressBarContainer, 'ov_progress_bar');
        progressBar.id = 'simulation_progress_bar';
        progressBar.style.width = '0%';
        
        this.progressDialog.Open();
        
        // Start the export process after a short delay (to allow UI to update)
        setTimeout(() => {
            this.processPhysicalGroups();
        }, 100);
    }

    /**
     * Process all physical groups for simulation
     */
    async processPhysicalGroups() {
        if (!this.website || !this.website.model) {
            this.finishSimulation('No model available');
            return;
        }
        
        const model = this.website.model;
        const groupIndices = Array.from(this.physicalGroups);
        
        try {
            // Process groups sequentially
            for (let i = 0; i < groupIndices.length; i++) {
                const groupIndex = groupIndices[i];
                const group = model.GetPhysicalGroup(groupIndex);
                
                if (!group) {
                    console.warn(`Physical group ${groupIndex} not found`);
                    continue;
                }
                
                const groupName = group.GetName() || `Group_${groupIndex}`;
                this.updateProgress(
                    `Processing ${groupName} (${i + 1}/${groupIndices.length})...`,
                    (i / groupIndices.length) * 100
                );
                
                // Export the group as GLB
                const glbData = await this.exportGroupAsGlb(model, group, groupIndex);
                if (!glbData) {
                    console.warn(`Failed to export group ${groupName}`);
                    continue;
                }
                
                // Upload the GLB data to the server
                this.updateProgress(
                    `Uploading ${groupName} (${i + 1}/${groupIndices.length})...`,
                    (i / groupIndices.length) * 100 + (100 / groupIndices.length) * 0.5
                );
                
                await this.uploadGlbToServer(glbData, groupName, groupIndex);
            }
            
            // All done
            this.finishSimulation('All physical groups have been simulated successfully.');
        } catch (error) {
            console.error('Error during simulation:', error);
            this.finishSimulation(`Error during simulation: ${error.message}`);
        }
    }

    /**
     * Export a physical group as GLB
     * @param {Object} model - The model containing the physical group
     * @param {Object} group - The physical group to export
     * @param {number} groupIndex - The index of the physical group
     * @returns {Promise<ArrayBuffer>} The GLB data
     */
    exportGroupAsGlb(model, group, groupIndex) {
        return new Promise((resolve, reject) => {
            try {
                // Create export settings with the physical group selected
                const settings = new ExporterSettings();
                settings.exportPhysicalGroups = true;
                settings.selectedGroups = [groupIndex];
                settings.exportRemainder = false;
                
                // Create an exporter model
                const exporterModel = new ExporterModel(model, settings);
                
                // Create a GLB exporter
                const exporter = new ExporterGltf();
                
                // Export the model
                const files = [];
                exporter.Export(exporterModel, FileFormat.Binary, (exportedFiles) => {
                    if (exportedFiles.length === 0) {
                        reject(new Error('No files were exported'));
                    } else {
                        // Get the GLB data
                        const glbFile = exportedFiles[0];
                        const glbData = glbFile.GetBufferContent();
                        resolve(glbData);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Upload a GLB file to the server
     * @param {ArrayBuffer} glbData - The GLB file data
     * @param {string} groupName - The name of the physical group
     * @param {number} groupIndex - The index of the physical group
     * @returns {Promise<void>}
     */
    async uploadGlbToServer(glbData, groupName, groupIndex) {
        // Create form data
        const formData = new FormData();
        const sanitizedName = groupName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const fileName = `${sanitizedName}.glb`;
        
        // Add the GLB file to the form data
        const glbBlob = new Blob([glbData], { type: 'application/octet-stream' });
        formData.append('file', glbBlob, fileName);
        formData.append('groupName', groupName);
        formData.append('groupIndex', groupIndex);
        
        // Upload to server
        try {
            const response = await fetch(this.serverEndpoint, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Server returned error: ${response.status} ${errorText}`);
            }
            
            // Successfully uploaded
            console.log(`Successfully uploaded ${fileName} to server`);
            return await response.json();
        } catch (error) {
            console.error(`Error uploading ${fileName}:`, error);
            throw error;
        }
    }

    /**
     * Update the progress dialog
     * @param {string} status - The status text to display
     * @param {number} percent - The percentage complete (0-100)
     */
    updateProgress(status, percent) {
        const statusDiv = document.getElementById('simulation_status');
        const progressBar = document.getElementById('simulation_progress_bar');
        
        if (statusDiv) {
            statusDiv.textContent = status;
        }
        
        if (progressBar) {
            progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        }
    }

    /**
     * Finish the simulation process
     * @param {string} message - The completion message
     */
    finishSimulation(message) {
        this.isExporting = false;
        
        if (this.progressDialog) {
            this.progressDialog.Close();
        }
        
        // Show completion message
        ShowMessageDialog(
            Loc('Simulation Complete'),
            Loc(message),
            null
        );
    }
}

// Create and register the plugin
const simulationPlugin = new SimulationPlugin();

// Register the plugin
RegisterPlugin(PluginType.Simulation, simulationPlugin);

// Export the plugin for external access
export { simulationPlugin };

// Initialize the plugin when the document is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    // Wait for the website to be initialized
    const checkWebsite = () => {
        // Look for the website instance in the global space
        if (window.website) {
            simulationPlugin.initialize(window.website);
        } else {
            // Try again after a short delay
            setTimeout(checkWebsite, 100);
        }
    };
    
    checkWebsite();
});

// Dispatch custom events
document.addEventListener('createphysicalgroup', (event) => {
    if (event.detail && event.detail.groupIndex !== undefined) {
        // Dispatch a custom event for physical group creation
        const customEvent = new CustomEvent('physical_group_created', {
            detail: { groupIndex: event.detail.groupIndex }
        });
        document.dispatchEvent(customEvent);
    }
});