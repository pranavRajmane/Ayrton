import { GetDomElementOuterWidth, SetDomElementOuterHeight, SetDomElementOuterWidth } from '../engine/viewer/domutils.js';
import { NavigatorFilesPanel } from './navigatorfilespanel.js';
import { NavigatorMaterialsPanel } from './navigatormaterialspanel.js';
import { NavigatorMeshesPanel } from './navigatormeshespanel.js';
import { PanelSet } from './panelset.js';

export const SelectionType =
{
    Material : 1,
    Mesh : 2
};

export class Selection
{
    constructor (type, data)
    {
        this.type = type;
        this.materialIndex = null;
        this.meshInstanceId = null;
        
        if (this.type === SelectionType.Material) {
            this.materialIndex = data;
        } else if (this.type === SelectionType.Mesh) {
            this.meshInstanceId = data;
        }
    }

    IsEqual (rhs)
    {
        if (this.type !== rhs.type) {
            return false;
        }
        if (this.type === SelectionType.Material) {
            return this.materialIndex === rhs.materialIndex;
        } else if (this.type === SelectionType.Mesh) {
            return this.meshInstanceId.IsEqual(rhs.meshInstanceId);
        }
        return false;
    }
    
    GetMeshInstanceId ()
    {
        if (this.type === SelectionType.Mesh) {
            return this.meshInstanceId;
        }
        return null;
    }
}

export class Navigator
{
    constructor (mainDiv)
    {
        this.mainDiv = mainDiv;

        this.panelSet = new PanelSet (mainDiv);
        this.callbacks = null;
        this.selection = null;
        this.selections = new Set(); // Store multiple selections
        this.tempSelectedMeshId = null;
        this.isMultiSelectionEnabled = false; // Track if multiselection is enabled

        this.filesPanel = new NavigatorFilesPanel (this.panelSet.GetContentDiv ());
        this.materialsPanel = new NavigatorMaterialsPanel (this.panelSet.GetContentDiv ());
        this.meshesPanel = new NavigatorMeshesPanel (this.panelSet.GetContentDiv ());

        this.panelSet.AddPanel (this.filesPanel);
        this.panelSet.AddPanel (this.materialsPanel);
        this.panelSet.AddPanel (this.meshesPanel);
        this.panelSet.ShowPanel (this.meshesPanel);
        
        // Listen for Ctrl/Command key to enable multiselection
        this.keyDownHandler = (event) => {
            console.log('Key Down:', event.key, 'Ctrl:', event.ctrlKey, 'Meta:', event.metaKey);
            if (event.ctrlKey || event.metaKey) {
                console.log('Multi-selection mode enabled');
                this.isMultiSelectionEnabled = true;
                // Add visual feedback for multi-selection mode
                this.mainDiv.classList.add('multi_selection_mode');
            }
        };
        
        this.keyUpHandler = (event) => {
            console.log('Key Up:', event.key, 'Ctrl:', event.ctrlKey, 'Meta:', event.metaKey);
            if (!event.ctrlKey && !event.metaKey) {
                console.log('Multi-selection mode disabled');
                this.isMultiSelectionEnabled = false;
                // Remove visual feedback for multi-selection mode
                this.mainDiv.classList.remove('multi_selection_mode');
            }
        };
        
        document.addEventListener('keydown', this.keyDownHandler);
        document.addEventListener('keyup', this.keyUpHandler);
    }

    IsPanelsVisible ()
    {
        return this.panelSet.IsPanelsVisible ();
    }

    ShowPanels (show)
    {
        this.panelSet.ShowPanels (show);
    }

    Init (callbacks)
    {
        this.callbacks = callbacks;

        this.panelSet.Init ({
            onResizeRequested : () => {
                this.callbacks.onResizeRequested ();
            },
            onShowHidePanels : (show) => {
                this.callbacks.onShowHidePanels (show);
            }
        });

        this.filesPanel.Init ({
            onFileBrowseButtonClicked : () => {
                this.callbacks.openFileBrowserDialog ();
            }
        });

        this.materialsPanel.Init ({
            onMaterialSelected : (materialIndex) => {
                this.SetSelection (new Selection (SelectionType.Material, materialIndex));
            },
            onMeshTemporarySelected : (meshInstanceId) => {
                this.tempSelectedMeshId = meshInstanceId;
                this.callbacks.onMeshSelectionChanged ();
            },
            onMeshSelected : (meshInstanceId) => {
                this.SetSelection (new Selection (SelectionType.Mesh, meshInstanceId));
            }
        });

        this.meshesPanel.Init ({
            onMeshSelected : (meshId) => {
                this.SetSelection (new Selection (SelectionType.Mesh, meshId));
            },
            onMeshShowHide : (meshId) => {
                this.ToggleMeshVisibility (meshId);
            },
            onMeshFitToWindow : (meshId) => {
                this.FitMeshToWindow (meshId);
            },
            onNodeShowHide : (nodeId) => {
                this.ToggleNodeVisibility (nodeId);
            },
            onNodeFitToWindow : (nodeId) => {
                this.FitNodeToWindow (nodeId);
            },
            onMaterialSelected : (materialIndex) => {
                this.SetSelection (new Selection (SelectionType.Material, materialIndex));
            },
            onViewTypeChanged : () => {
                this.SetSelection (null);
            }
        });
    }

    GetWidth ()
    {
        return GetDomElementOuterWidth (this.mainDiv);
    }

    SetWidth (width)
    {
        SetDomElementOuterWidth (this.mainDiv, width);
    }

    Resize (height)
    {
        SetDomElementOuterHeight (this.mainDiv, height);
        this.panelSet.Resize ();
    }

    FillTree (importResult)
    {
        this.filesPanel.Fill (importResult);
        if (importResult.missingFiles.length === 0) {
            this.panelSet.SetPanelIcon (this.filesPanel, 'files');
        } else {
            this.panelSet.SetPanelIcon (this.filesPanel, 'missing_files');
        }
        this.materialsPanel.Fill (importResult);
        this.meshesPanel.Fill (importResult);
        this.OnSelectionChanged ();
    }

    MeshItemCount ()
    {
        return this.meshesPanel.MeshItemCount ();
    }

    IsMeshVisible (meshInstanceId)
    {
        return this.meshesPanel.IsMeshVisible (meshInstanceId);
    }

    HasHiddenMesh ()
    {
        return this.meshesPanel.HasHiddenMesh ();
    }

    ShowAllMeshes (show)
    {
        this.meshesPanel.ShowAllMeshes (show);
        this.callbacks.onMeshVisibilityChanged ();
    }

    ToggleNodeVisibility (nodeId)
    {
        this.meshesPanel.ToggleNodeVisibility (nodeId);
        this.callbacks.onMeshVisibilityChanged ();
    }

    ToggleMeshVisibility (meshInstanceId)
    {
        // If specific mesh provided, toggle just that one
        if (meshInstanceId) {
            this.meshesPanel.ToggleMeshVisibility (meshInstanceId);
            this.callbacks.onMeshVisibilityChanged ();
            return;
        }
        
        // If no specific mesh, toggle all selected meshes if in multi-selection mode
        if (this.selections.size > 0) {
            const selectedMeshes = this.GetAllSelectedMeshIds();
            for (const meshId of selectedMeshes) {
                this.meshesPanel.ToggleMeshVisibility(meshId);
            }
            this.callbacks.onMeshVisibilityChanged();
        } else if (this.selection && this.selection.type === SelectionType.Mesh) {
            // Fallback to single selection for backward compatibility
            this.meshesPanel.ToggleMeshVisibility(this.selection.meshInstanceId);
            this.callbacks.onMeshVisibilityChanged();
        }
    }

    IsMeshIsolated (meshInstanceId)
    {
        return this.meshesPanel.IsMeshIsolated (meshInstanceId);
    }

    IsolateMesh (meshInstanceId)
    {
        // If specific mesh provided, isolate just that one
        if (meshInstanceId) {
            this.meshesPanel.IsolateMesh (meshInstanceId);
            this.callbacks.onMeshVisibilityChanged ();
            return;
        }
        
        // If no specific mesh, isolate all selected meshes if in multi-selection mode
        if (this.selections.size > 0) {
            // First hide all meshes
            this.ShowAllMeshes(false);
            
            // Then show only the selected ones
            const selectedMeshes = this.GetAllSelectedMeshIds();
            for (const meshId of selectedMeshes) {
                this.meshesPanel.ToggleMeshVisibility(meshId);
            }
            this.callbacks.onMeshVisibilityChanged();
        } else if (this.selection && this.selection.type === SelectionType.Mesh) {
            // Fallback to single selection for backward compatibility
            this.meshesPanel.IsolateMesh(this.selection.meshInstanceId);
            this.callbacks.onMeshVisibilityChanged();
        }
    }
    
    SetMeshVisibility (meshInstanceId, isVisible)
    {
        if (!meshInstanceId) {
            return;
        }
        
        const meshItem = this.meshesPanel.GetMeshItem(meshInstanceId);
        if (meshItem && meshItem.IsVisible() !== isVisible) {
            meshItem.SetVisible(isVisible, NavigatorItemRecurse.Parents);
        }
    }
    
    IsMeshVisible (meshInstanceId)
    {
        if (!meshInstanceId) {
            return false;
        }
        
        const meshItem = this.meshesPanel.GetMeshItem(meshInstanceId);
        return meshItem && meshItem.IsVisible();
    }

    GetSelectedMeshId ()
    {
        if (this.tempSelectedMeshId !== null) {
            return this.tempSelectedMeshId;
        }
        
        // If no multi-selection, return the primary selection (backward compatibility)
        if (this.selections.size === 0) {
            if (this.selection === null) {
                return null;
            }
            
            // Handle both mesh and face selections
            return this.selection.GetMeshInstanceId();
        } else {
            // Return the last selected mesh for compatibility with existing code
            if (this.selection) {
                return this.selection.GetMeshInstanceId();
            }
            return null;
        }
    }
    
    // Get all selected mesh IDs, for multi-selection support
    GetAllSelectedMeshIds ()
    {
        const result = new Set();
        
        // Add temporary selection if exists
        if (this.tempSelectedMeshId !== null) {
            result.add(this.tempSelectedMeshId);
            return result;
        }
        
        // Add all selections from the set
        for (const selection of this.selections) {
            const meshId = selection.GetMeshInstanceId();
            if (meshId) {
                result.add(meshId);
            }
        }
        
        // Also add primary selection if exists and not in multi-select mode
        if (this.selection !== null) {
            const meshId = this.selection.GetMeshInstanceId();
            if (meshId) {
                result.add(meshId);
            }
        }
        
        return result;
    }
    

    SetSelection (selection)
    {
        function SetEntitySelection (navigator, selection, select)
        {
            if (selection.type === SelectionType.Material) {
                if (select && navigator.panelSet.IsPanelsVisible ()) {
                    navigator.panelSet.ShowPanel (navigator.materialsPanel);
                }
                navigator.materialsPanel.SelectMaterialItem (selection.materialIndex, select);
            } else if (selection.type === SelectionType.Mesh) {
                if (select && navigator.panelSet.IsPanelsVisible ()) {
                    navigator.panelSet.ShowPanel (navigator.meshesPanel);
                }
                navigator.meshesPanel.GetMeshItem (selection.meshInstanceId).SetSelected (select);
            }
        }

        function SetCurrentSelection (navigator, selection)
        {
            navigator.selection = selection;
            navigator.OnSelectionChanged ();
        }

        // Handle multi-selection mode
        if (selection !== null && selection.type === SelectionType.Mesh && this.isMultiSelectionEnabled) {
            console.log('Multi-selection mode is active, handling click on mesh:', selection.meshInstanceId.GetKey());
            
            // Check if this mesh is already selected
            let isAlreadySelected = false;
            let existingSelectionToRemove = null;
            
            for (const existingSelection of this.selections) {
                if (existingSelection.type === SelectionType.Mesh && 
                    existingSelection.meshInstanceId.GetKey() === selection.meshInstanceId.GetKey()) {
                    isAlreadySelected = true;
                    existingSelectionToRemove = existingSelection;
                    break;
                }
            }
            
            if (isAlreadySelected && existingSelectionToRemove) {
                console.log('Deselecting already selected mesh:', selection.meshInstanceId.GetKey());
                // Deselect the mesh if already selected
                this.selections.delete(existingSelectionToRemove);
                
                // Use the multi-selection method for UI update
                const meshItem = this.meshesPanel.GetMeshItem(selection.meshInstanceId);
                console.log('Setting multi-selected false for:', meshItem);
                if (meshItem) {
                    meshItem.SetMultiSelected(false);
                    meshItem.SetSelected(false);
                }
            } else {
                console.log('Adding mesh to selection:', selection.meshInstanceId.GetKey());
                // Add to multi-selection
                const selectionCopy = new Selection(selection.type, selection.meshInstanceId);
                this.selections.add(selectionCopy);
                
                // Use the multi-selection method for UI update
                const meshItem = this.meshesPanel.GetMeshItem(selection.meshInstanceId);
                console.log('Setting multi-selected true for:', meshItem);
                if (meshItem) {
                    meshItem.SetMultiSelected(true);
                    // Also set as the current selection
                    meshItem.SetSelected(true);
                }
            }
            
            // Keep the last selection as the 'primary' selection
            this.selection = selection;
            this.tempSelectedMeshId = null;
            console.log('Current selections:', Array.from(this.selections).length);
            this.callbacks.onMeshSelectionChanged();
            return;
        }
        
        // Clear all existing multi-selections when not in multi-select mode
        if (!this.isMultiSelectionEnabled && this.selections.size > 0) {
            console.log('Clearing all multi-selections');
            
            // First clear all multi-selection visual indicators
            for (const existingSelection of this.selections) {
                if (existingSelection.type === SelectionType.Mesh) {
                    const meshItem = this.meshesPanel.GetMeshItem(existingSelection.meshInstanceId);
                    if (meshItem) {
                        console.log('Clearing multi-selection for:', meshItem.name);
                        meshItem.SetMultiSelected(false);
                    }
                }
            }
            
            // Then clear the actual selection set
            this.selections.clear();
        }

        // Handle single selection (normal mode)
        let oldSelection = this.selection;
        if (oldSelection !== null) {
            SetEntitySelection(this, oldSelection, false);
        }

        SetCurrentSelection(this, selection);
        this.tempSelectedMeshId = null;

        if (this.selection !== null) {
            if (oldSelection !== null && oldSelection.IsEqual(this.selection)) {
                SetEntitySelection(this, this.selection, false);
                SetCurrentSelection(this, null);
            } else {
                SetEntitySelection(this, this.selection, true);
            }
        }

        this.callbacks.onMeshSelectionChanged();
    }

    OnSelectionChanged ()
    {
        // Clear selection handling
        if (this.selection === null && this.selections.size === 0) {
            this.callbacks.onSelectionCleared ();
            this.UpdatePanels ();
            return;
        }
        
        // Material selection handling
        if (this.selection && this.selection.type === SelectionType.Material) {
            this.callbacks.onMaterialSelected (this.selection.materialIndex);
            this.UpdatePanels ();
            return;
        }
        
        // Multiple mesh selection handling
        if (this.selections.size > 0) {
            // Get all selected mesh IDs
            const selectedMeshes = this.GetAllSelectedMeshIds();
            
            // If there's a callback for multiple selections, use it
            if (this.callbacks.onMultipleMeshesSelected) {
                this.callbacks.onMultipleMeshesSelected(selectedMeshes);
            } else {
                // Otherwise, for backward compatibility, use the last selected mesh
                if (this.selection) {
                    const meshId = this.selection.GetMeshInstanceId();
                    if (meshId) {
                        this.callbacks.onMeshSelected(meshId);
                    }
                }
            }
        } else if (this.selection) {
            // Single mesh selection (backward compatibility)
            const meshId = this.selection.GetMeshInstanceId();
            if (meshId) {
                this.callbacks.onMeshSelected(meshId);
            }
        }
        
        this.UpdatePanels();
    }

    UpdatePanels ()
    {
        let materialIndex = null;
        let meshInstanceId = null;
        if (this.selection !== null) {
            if (this.selection.type === SelectionType.Material) {
                materialIndex = this.selection.materialIndex;
            } else if (this.selection.type === SelectionType.Mesh) {
                meshInstanceId = this.selection.meshInstanceId;
            }
        }

        let usedByMeshes = this.callbacks.getMeshesForMaterial (materialIndex);
        this.materialsPanel.UpdateMeshList (usedByMeshes);

        let usedByMaterials = this.callbacks.getMaterialsForMesh (meshInstanceId);
        this.meshesPanel.UpdateMaterialList (usedByMaterials);
    }

    FitNodeToWindow (nodeId)
    {
        let meshInstanceIdSet = new Set ();
        let nodeItem = this.meshesPanel.GetNodeItem (nodeId);
        nodeItem.EnumerateMeshItems ((meshItem) => {
            meshInstanceIdSet.add (meshItem.GetMeshInstanceId ());
        });
        this.callbacks.fitMeshesToWindow (meshInstanceIdSet);
    }

    FitMeshToWindow (meshInstanceId)
    {
        // Handle single mesh fit
        if (meshInstanceId) {
            this.callbacks.fitMeshToWindow (meshInstanceId);
            return;
        }
        
        // If no specific mesh provided, fit all selected meshes if there are multiple selections
        if (this.selections.size > 0) {
            const selectedMeshes = this.GetAllSelectedMeshIds();
            this.callbacks.fitMeshesToWindow(selectedMeshes);
        } else if (this.selection && this.selection.type === SelectionType.Mesh) {
            // Fallback to single selection for backward compatibility
            this.callbacks.fitMeshToWindow(this.selection.meshInstanceId);
        }
    }

    Clear ()
    {
        this.panelSet.Clear ();
        this.selection = null;
        this.selections.clear();
        this.isMultiSelectionEnabled = false;
        this.mainDiv.classList.remove('multi_selection_mode');
    }
    
    // Method to clean up event listeners when needed
    Dispose ()
    {
        if (this.keyDownHandler) {
            document.removeEventListener('keydown', this.keyDownHandler);
        }
        if (this.keyUpHandler) {
            document.removeEventListener('keyup', this.keyUpHandler);
        }
    }
}
