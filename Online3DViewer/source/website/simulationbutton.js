import { Loc } from '../engine/core/localization.js';
import { ShowDomElement } from '../engine/viewer/domutils.js';
import { AddDiv } from '../engine/viewer/domutils.js';
import { AddSvgIconElement } from './utils.js';
import { ShowMessageDialog } from './dialogs.js';
import { ButtonDialog } from './dialog.js';
import { FileFormat } from '../engine/io/fileutils.js';
import { ExporterSettings } from '../engine/export/exportermodel.js';
import { Exporter } from '../engine/export/exporter.js';

/**
 * SimulationButton - A self-initializing module that adds a "Simulate" button to the toolbar
 * which exports all physical groups as GLB files to the server.
 */
class SimulationButton {
    constructor() {
        this.simulateButton = null;
        this.progressDialog = null;
        this.isExporting = false;
        this.serverEndpoint = '/api/upload';
        this.physicalGroups = new Set();
        
        // Initialize when DOM is loaded
        document.addEventListener('DOMContentLoaded', () => {
            this.initializeButton();
        });
        
        // Listen for events
        document.addEventListener('model_loaded', () => {
            setTimeout(() => {
                this.checkForPhysicalGroups();
            }, 500);
        });
    }
    
    /**
     * Create and add the Simulate button to the toolbar
     */
    initializeButton() {
        // Wait for toolbar to be available
        const waitForToolbar = () => {
            const toolbarDiv = document.querySelector('.ov_toolbar');
            if (!toolbarDiv) {
                setTimeout(waitForToolbar, 100);
                return;
            }
            
            // Create simulate button
            this.simulateButton = document.createElement('div');
            this.simulateButton.className = 'ov_toolbar_button only_on_model';
            this.simulateButton.title = Loc('Simulate Physical Groups');
            
            // Add icon to button (using print3d icon)
            AddSvgIconElement(this.simulateButton, 'print3d');
            
            // Add handler for button click
            this.simulateButton.addEventListener('click', () => {
                this.handleSimulateClick();
            });
            
            // Add separator
            const separator = document.createElement('div');
            separator.className = 'ov_toolbar_separator only_on_model';
            
            // Insert separator and button
            toolbarDiv.appendChild(separator);
            toolbarDiv.appendChild(this.simulateButton);
            
            // Hide initially
            ShowDomElement(this.simulateButton, false);
            
            // Check for physical groups if a model is already loaded
            this.checkForPhysicalGroups();
        };
        
        waitForToolbar();
    }
    
    /**
     * Check if the current model has physical groups
     */
    checkForPhysicalGroups() {
        // Reset groups
        this.physicalGroups.clear();
        
        // Find the viewer
        const viewer = this.findViewer();
        if (!viewer || !viewer.model) {
            if (this.simulateButton) {
                ShowDomElement(this.simulateButton, false);
            }
            return;
        }
        
        const model = viewer.model;
        
        // Check if model has physical groups
        if (model.physicalGroups && model.physicalGroups.length > 0) {
            for (let i = 0; i < model.physicalGroups.length; i++) {
                this.physicalGroups.add(i);
            }
            
            // Show button
            if (this.simulateButton) {
                ShowDomElement(this.simulateButton, true);
            }
        } else {
            // Hide button
            if (this.simulateButton) {
                ShowDomElement(this.simulateButton, false);
            }
        }
    }
    
    /**
     * Find the viewer instance
     */
    findViewer() {
        // Try different ways to find the viewer
        
        // Method 1: From window.OV
        if (window.OV && window.OV.viewer) {
            return window.OV.viewer;
        }
        
        // Method 2: Look at the DOM
        const viewerDiv = document.getElementById('main_viewer');
        if (viewerDiv && viewerDiv._viewer) {
            return viewerDiv._viewer;
        }
        
        // Method 3: Look for OV namespace
        if (window.OV && window.OV.Viewer) {
            const allViewers = document.querySelectorAll('.viewer');
            for (const elem of allViewers) {
                if (elem._viewer) {
                    return elem._viewer;
                }
            }
        }
        
        return null;
    }
    
    /**
     * Handle simulate button click
     */
    handleSimulateClick() {
        if (this.isExporting) {
            return;
        }
        
        // Find viewer and model
        const viewer = this.findViewer();
        if (!viewer || !viewer.model) {
            ShowMessageDialog(
                Loc('No Model'),
                Loc('No model is loaded.'),
                null
            );
            return;
        }
        
        const model = viewer.model;
        
        // Check for physical groups
        if (!model.physicalGroups || model.physicalGroups.length === 0) {
            ShowMessageDialog(
                Loc('No Physical Groups'),
                Loc('There are no physical groups to simulate. Please create physical groups first.'),
                null
            );
            return;
        }
        
        // Confirm simulation
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
                        this.startSimulation(model);
                    }
                }
            ]
        );
        
        // Add description
        const contentDiv = confirmDialog.GetContentDiv();
        AddDiv(contentDiv, 'ov_dialog_section', 
            Loc(`This will export all ${model.physicalGroups.length} physical groups as GLB files and send them to the server for simulation.`)
        );
        
        confirmDialog.Open();
    }
    
    /**
     * Start simulation process
     */
    startSimulation(model) {
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
        
        // Start processing after a short delay
        setTimeout(() => {
            this.processPhysicalGroups(model);
        }, 100);
    }
    
    /**
     * Process all physical groups
     */
    async processPhysicalGroups(model) {
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
                
                const groupName = group.GetName ? group.GetName() : (group.name || `Group_${groupIndex}`);
                this.updateProgress(
                    `Processing ${groupName} (${i + 1}/${groupIndices.length})...`,
                    (i / groupIndices.length) * 100
                );
                
                // Export the group as GLB
                try {
                    const files = await this.exportGroupAsGlb(model, groupIndex);
                    if (!files || files.length === 0) {
                        console.warn(`No files exported for group ${groupName}`);
                        continue;
                    }
                    
                    // Upload the exported file
                    this.updateProgress(
                        `Uploading ${groupName} (${i + 1}/${groupIndices.length})...`,
                        (i / groupIndices.length) * 100 + (100 / groupIndices.length) * 0.5
                    );
                    
                    await this.uploadGlbToServer(files[0], groupName, groupIndex);
                } catch (error) {
                    console.error(`Error exporting group ${groupName}:`, error);
                }
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
     */
/**
 * Export a physical group as GLB
 */
exportGroupAsGlb(model, groupIndex) {
    return new Promise((resolve, reject) => {
        // Get the physical group
        const physicalGroup = model.GetPhysicalGroup(groupIndex);
        if (!physicalGroup) {
            reject(new Error(`Physical group ${groupIndex} not found`));
            return;
        }
        if (typeof model.CreateModelFromPhysicalGroup === 'function') {
            console.log('CreateModelFromPhysicalGroup method exists - using it');}
            const tempModel = model.CreateModelFromPhysicalGroup(groupIndex);

        // Create a temporary model with only meshes from this group
        
        
        // If your codebase doesn't have CreateModelFromPhysicalGroup, you might need to:
        // 1. Clone the model
        // 2. Hide all meshes not in the physical group
        // 3. Export the model with only visible meshes
        
        // Create export settings (no need for physical group settings)
        const settings = new ExporterSettings();
        // We're not using physical group filtering since we've already filtered the model
        
        // Create exporter
        const exporter = new Exporter();
        
        // Export as GLB
        exporter.Export(tempModel, settings, FileFormat.Binary, 'glb', {
            onError: () => {
                reject(new Error('Export failed'));
            },
            onSuccess: (files) => {
                resolve(files);
            }
        });
    });
}
    
    /**
     * Upload GLB file to server
     */
 /**
 * Upload GLB file to server
 */
async uploadGlbToServer(file, groupName, groupIndex) {
    // Generate a unique model ID if it doesn't exist yet
    if (!this.modelId) {
        // Use timestamp + random string for uniqueness
        this.modelId = Date.now() + '-' + Math.random().toString(36).substring(2, 10);
    }
    
    // Create form data
    const formData = new FormData();
    const sanitizedName = groupName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${sanitizedName}.glb`;
    
    // Add the file to form data
    const blob = new Blob([file.content], { type: 'application/octet-stream' });
    formData.append('files', blob, fileName);
    formData.append('groupName', groupName);
    formData.append('groupIndex', groupIndex);
    formData.append('modelId', this.modelId); // Add model ID to request
    
    // Upload to server using fetch API for better error handling
    try {
        const response = await fetch(this.serverEndpoint, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Upload error:', error);
        throw error;
    }
}
    
    /**
     * Update progress dialog
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
     * Finish simulation
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

/**
 * RedirectButton - A button next to the simulate button that redirects to a specified URL
 */
class RedirectButton {
    constructor() {
        this.redirectButton = null;
        this.redirectUrl = 'http://3.93.194.93:3000';
        
        // Initialize when DOM is loaded
        document.addEventListener('DOMContentLoaded', () => {
            this.initializeButton();
        });
    }
    
    /**
     * Create and add the Redirect button to the toolbar
     */
    initializeButton() {
        // Wait for toolbar and simulate button to be available
        const waitForToolbar = () => {
            const simulateButton = document.querySelector('.ov_toolbar .ov_toolbar_button[title="Simulate Physical Groups"]');
            if (!simulateButton) {
                setTimeout(waitForToolbar, 100);
                return;
            }
            
            // Create redirect button
            this.redirectButton = document.createElement('div');
            this.redirectButton.className = 'ov_toolbar_button';
            this.redirectButton.title = 'Open External Tool';
            
            // Add icon to button (using share icon)
            AddSvgIconElement(this.redirectButton, 'share');
            
            // Add handler for button click
            this.redirectButton.addEventListener('click', () => {
                window.open(this.redirectUrl, '_blank');
            });
            
            // Insert button right after the simulate button
            simulateButton.parentNode.insertBefore(this.redirectButton, simulateButton.nextSibling);
        };
        
        waitForToolbar();
    }
}

// Create singleton instances
const simulationButton = new SimulationButton();
const redirectButton = new RedirectButton();

// Export for external access
export { simulationButton, redirectButton };