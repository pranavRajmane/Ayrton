import { FileFormat, GetFileExtension, TransformFileHostUrls } from '../engine/io/fileutils.js';
import { TextWriter } from '../engine/io/textwriter.js';
import { InputFilesFromFileObjects, InputFilesFromUrls } from '../engine/import/importerfiles.js';
import { ImportErrorCode, ImportSettings } from '../engine/import/importer.js';
import { NavigationMode, ProjectionMode } from '../engine/viewer/camera.js';
import { RGBColor } from '../engine/model/color.js';
import { Viewer } from '../engine/viewer/viewer.js';
import { AddDiv, AddDomElement, ShowDomElement, SetDomElementOuterHeight, CreateDomElement, GetDomElementOuterWidth, GetDomElementOuterHeight } from '../engine/viewer/domutils.js';
import { CalculatePopupPositionToScreen, ShowListPopup, ShowMessageDialog } from './dialogs.js';
import { ButtonDialog, ProgressDialog } from './dialog.js';
import { HandleEvent } from './eventhandler.js';
import { HashHandler } from './hashhandler.js';
import { Navigator, Selection, SelectionType } from './navigator.js';
import { NavigatorItemRecurse } from './navigatoritems.js';
import { CameraSettings, Settings, Theme } from './settings.js';
import { Sidebar } from './sidebar.js';
import { ThemeHandler } from './themehandler.js';
import { ThreeModelLoaderUI } from './threemodelloaderui.js';
import { Toolbar } from './toolbar.js';
import { DownloadModel, ShowExportDialog } from './exportdialog.js';
import { ShowSnapshotDialog } from './snapshotdialog.js';
import { AddSvgIconElement, DownloadArrayBufferAsFile, GetFilesFromDataTransfer, InstallTooltip, IsSmallWidth } from './utils.js';
import { ShowOpenUrlDialog } from './openurldialog.js';
import { ShowSharingDialog } from './sharingdialog.js';
import { GetDefaultMaterials, ReplaceDefaultMaterialsColor } from '../engine/model/modelutils.js';
import { Direction } from '../engine/geometry/geometry.js';
import { CookieGetBoolVal, CookieSetBoolVal } from './cookiehandler.js';
import { MeasureTool } from './measuretool.js';
import { CloseAllDialogs } from './dialog.js';
import { CreateVerticalSplitter } from './splitter.js';
import { EnumeratePlugins, PluginType } from './pluginregistry.js';
import { EnvironmentSettings } from '../engine/viewer/shadingmodel.js';
import { ExporterSettings } from '../engine/export/exportermodel.js';
import { Exporter } from '../engine/export/exporter.js';
import { RunTaskAsync } from '../engine/core/taskrunner.js';
import { IntersectionMode } from '../engine/viewer/viewermodel.js';
import { Loc } from '../engine/core/localization.js';

const WebsiteUIState =
{
    Undefined : 0,
    Intro : 1,
    Model : 2,
    Loading : 3
};

class WebsiteLayouter
{
    constructor (parameters, navigator, sidebar, viewer, measureTool)
    {
        this.parameters = parameters;
        this.navigator = navigator;
        this.sidebar = sidebar;
        this.viewer = viewer;
        this.measureTool = measureTool;
        this.limits = {
            minPanelWidth : 290,
            minCanvasWidth : 100
        };
    }

    Init ()
    {
        this.InstallSplitter (this.parameters.navigatorSplitterDiv, this.parameters.navigatorDiv, (originalWidth, xDiff) => {
            let newWidth = originalWidth + xDiff;
            this.OnSplitterDragged (newWidth - this.navigator.GetWidth (), 0);
        });

        this.InstallSplitter (this.parameters.sidebarSplitterDiv, this.parameters.sidebarDiv, (originalWidth, xDiff) => {
            let newWidth = originalWidth - xDiff;
            this.OnSplitterDragged (0, newWidth - this.sidebar.GetWidth ());
        });

        this.Resize ();
    }

    InstallSplitter (splitterDiv, resizedDiv, onSplit)
    {
        let originalWidth = null;
        CreateVerticalSplitter (splitterDiv, {
            onSplitStart : () => {
                originalWidth = GetDomElementOuterWidth (resizedDiv);
            },
            onSplit : (xDiff) => {
                onSplit (originalWidth, xDiff);
            }
        });
    }

    OnSplitterDragged (leftDiff, rightDiff)
    {
        let windowWidth = window.innerWidth;

        let navigatorWidth = this.navigator.GetWidth ();
        let sidebarWidth = this.sidebar.GetWidth ();

        let leftWidth = GetDomElementOuterWidth (this.parameters.leftContainerDiv);
        let rightWidth = GetDomElementOuterWidth (this.parameters.rightContainerDiv);

        let newLeftWidth = leftWidth + leftDiff;
        let newRightWidth = rightWidth + rightDiff;
        let contentNewWidth = windowWidth - newLeftWidth - newRightWidth;

        let isNavigatorVisible = this.navigator.IsPanelsVisible ();
        let isSidebarVisible = this.sidebar.IsPanelsVisible ();

        if (isNavigatorVisible && newLeftWidth < this.limits.minPanelWidth) {
            newLeftWidth = this.limits.minPanelWidth;
        }

        if (isSidebarVisible && newRightWidth < this.limits.minPanelWidth) {
            newRightWidth = this.limits.minPanelWidth;
        }

        if (contentNewWidth < this.limits.minCanvasWidth) {
            if (leftDiff > 0) {
                newLeftWidth = windowWidth - newRightWidth - this.limits.minCanvasWidth;
            } else if (rightDiff > 0) {
                newRightWidth = windowWidth - newLeftWidth - this.limits.minCanvasWidth;
            }
        }

        if (isNavigatorVisible) {
            let newNavigatorWidth = navigatorWidth + (newLeftWidth - leftWidth);
            this.navigator.SetWidth (newNavigatorWidth);
        }
        if (isSidebarVisible) {
            let newSidebarWidth = sidebarWidth + (newRightWidth - rightWidth);
            this.sidebar.SetWidth (newSidebarWidth);
        }

        this.Resize ();
    }

    Resize ()
    {
        let windowWidth = window.innerWidth;
        let windowHeight = window.innerHeight;
        let headerHeight = this.parameters.headerDiv.offsetHeight;

        let leftWidth = 0;
        let rightWidth = 0;
        let safetyMargin = 0;
        if (!IsSmallWidth ()) {
            leftWidth = GetDomElementOuterWidth (this.parameters.leftContainerDiv);
            rightWidth = GetDomElementOuterWidth (this.parameters.rightContainerDiv);
            safetyMargin = 1;
        }

        let contentWidth = windowWidth - leftWidth - rightWidth;
        let contentHeight = windowHeight - headerHeight;

        if (contentWidth < this.limits.minCanvasWidth) {
            let neededIncrease = this.limits.minCanvasWidth - contentWidth;

            let isNavigatorVisible = this.navigator.IsPanelsVisible ();
            let isSidebarVisible = this.sidebar.IsPanelsVisible ();

            if (neededIncrease > 0 && isNavigatorVisible) {
                let navigatorDecrease = Math.min (neededIncrease, leftWidth - this.limits.minPanelWidth);
                this.navigator.SetWidth (this.navigator.GetWidth () - navigatorDecrease);
                neededIncrease = neededIncrease - navigatorDecrease;
            }

            if (neededIncrease > 0 && isSidebarVisible) {
                let sidebarDecrease = Math.min (neededIncrease, rightWidth - this.limits.minPanelWidth);
                this.sidebar.SetWidth (this.sidebar.GetWidth () - sidebarDecrease);
            }

            leftWidth = GetDomElementOuterWidth (this.parameters.leftContainerDiv);
            rightWidth = GetDomElementOuterWidth (this.parameters.rightContainerDiv);
            contentWidth = windowWidth - leftWidth - rightWidth;
        }

        this.navigator.Resize (contentHeight);
        SetDomElementOuterHeight (this.parameters.navigatorSplitterDiv, contentHeight);

        this.sidebar.Resize (contentHeight);
        SetDomElementOuterHeight (this.parameters.sidebarSplitterDiv, contentHeight);

        SetDomElementOuterHeight (this.parameters.introDiv, contentHeight);
        this.viewer.Resize (contentWidth - safetyMargin, contentHeight);

        let introContentHeight = GetDomElementOuterHeight (this.parameters.introContentDiv);
        let introContentTop = (contentHeight - introContentHeight) / 3.0;
        this.parameters.introContentDiv.style.top = introContentTop.toString () + 'px';

        this.measureTool.Resize ();
    }
}

export class Website
{
    constructor (parameters)
    {
        this.parameters = parameters;
        this.settings = new Settings (Theme.Light);
        this.cameraSettings = new CameraSettings ();
        this.viewer = new Viewer ();
        this.measureTool = new MeasureTool (this.viewer, this.settings);
        this.hashHandler = new HashHandler ();
        this.toolbar = new Toolbar (this.parameters.toolbarDiv);
        this.navigator = new Navigator (this.parameters.navigatorDiv);
        this.sidebar = new Sidebar (this.parameters.sidebarDiv, this.settings);
        this.modelLoaderUI = new ThreeModelLoaderUI ();
        this.themeHandler = new ThemeHandler ();
        this.highlightColor = new RGBColor (142, 201, 240);
        this.uiState = WebsiteUIState.Undefined;
        this.layouter = new WebsiteLayouter (this.parameters, this.navigator, this.sidebar, this.viewer, this.measureTool);
        this.model = null;
    }

    Load ()
    {
        this.settings.LoadFromCookies ();
        this.cameraSettings.LoadFromCookies ();

        // Force dark theme
        HandleEvent ('theme_on_load', 'dark');

        EnumeratePlugins (PluginType.Header, (plugin) => {
            plugin.registerButtons ({
                createHeaderButton : (icon, title, link) => {
                    this.CreateHeaderButton (icon, title, link);
                }
            });
        });

        this.InitViewer ();
        this.InitToolbar ();
        this.InitDragAndDrop ();
        this.InitSidebar ();
        this.InitNavigator ();
        this.InitCookieConsent ();

        this.viewer.SetMouseClickHandler (this.OnModelClicked.bind (this));
        this.viewer.SetMouseMoveHandler (this.OnModelMouseMoved.bind (this));
        this.viewer.SetContextMenuHandler (this.OnModelContextMenu.bind (this));

        this.layouter.Init ();
        this.SetUIState (WebsiteUIState.Intro);

        this.hashHandler.SetEventListener (this.OnHashChange.bind (this));
        this.OnHashChange ();

        window.addEventListener ('resize', () => {
			this.layouter.Resize ();
		});
    }

    HasLoadedModel ()
    {
        return this.model !== null;
    }

    SetUIState (uiState)
    {
        function ShowOnlyOnModelElements (show)
        {
            let root = document.querySelector (':root');
            root.style.setProperty ('--ov_only_on_model_display', show ? 'inherit' : 'none');
        }

        if (this.uiState === uiState) {
            return;
        }

        this.uiState = uiState;
        if (this.uiState === WebsiteUIState.Intro) {
            ShowDomElement (this.parameters.introDiv, true);
            ShowDomElement (this.parameters.headerDiv, true);
            ShowDomElement (this.parameters.mainDiv, false);
            ShowOnlyOnModelElements (false);
        } else if (this.uiState === WebsiteUIState.Model) {
            ShowDomElement (this.parameters.introDiv, false);
            ShowDomElement (this.parameters.headerDiv, true);
            ShowDomElement (this.parameters.mainDiv, true);
            ShowOnlyOnModelElements (true);
            this.UpdatePanelsVisibility ();
        } else if (this.uiState === WebsiteUIState.Loading) {
            ShowDomElement (this.parameters.introDiv, false);
            ShowDomElement (this.parameters.headerDiv, true);
            ShowDomElement (this.parameters.mainDiv, false);
            ShowOnlyOnModelElements (false);
        }

        this.layouter.Resize ();
    }

    ClearModel ()
    {
        CloseAllDialogs ();

        this.model = null;
        this.viewer.Clear ();

        this.parameters.fileNameDiv.innerHTML = '';

        this.navigator.Clear ();
        this.sidebar.Clear ();

        this.measureTool.SetActive (false);
    }

    OnModelLoaded (importResult, threeObject)
    {
        this.model = importResult.model;
        this.parameters.fileNameDiv.innerHTML = importResult.mainFile;
        this.viewer.SetMainObject (threeObject);
        this.viewer.SetUpVector (Direction.Y, false);
        this.navigator.FillTree (importResult);
        this.sidebar.UpdateControlsVisibility ();
        this.FitModelToWindow (true);
    }

    OnModelClicked (button, mouseCoordinates)
    {
        if (button !== 1) {
            return;
        }

        if (this.measureTool.IsActive ()) {
            this.measureTool.Click (mouseCoordinates);
            return;
        }

        let meshUserData = this.viewer.GetMeshUserDataUnderMouse (IntersectionMode.MeshAndLine, mouseCoordinates);
        if (meshUserData === null) {
            this.navigator.SetSelection (null);
        } else {
            // Normal mesh selection
            this.navigator.SetSelection(new Selection(SelectionType.Mesh, meshUserData.originalMeshInstance.id));
        }
    }

    OnModelMouseMoved (mouseCoordinates)
    {
        if (this.measureTool.IsActive ()) {
            this.measureTool.MouseMove (mouseCoordinates);
        }
    }

    OnModelContextMenu (globalMouseCoordinates, mouseCoordinates)
    {
        let meshUserData = this.viewer.GetMeshUserDataUnderMouse (IntersectionMode.MeshAndLine, mouseCoordinates);
        let items = [];
        if (meshUserData === null) {
            items.push ({
                name : Loc ('Fit model to window'),
                icon : 'fit',
                onClick : () => {
                    this.FitModelToWindow (false);
                }
            });
            if (this.navigator.HasHiddenMesh ()) {
                items.push ({
                    name : Loc ('Show all meshes'),
                    icon : 'visible',
                    onClick : () => {
                        this.navigator.ShowAllMeshes (true);
                    }
                });
            }
        } else {
            items.push ({
                name : Loc ('Hide mesh'),
                icon : 'hidden',
                onClick : () => {
                    this.navigator.ToggleMeshVisibility (meshUserData.originalMeshInstance.id);
                }
            });
            items.push ({
                name : Loc ('Fit mesh to window'),
                icon : 'fit',
                onClick : () => {
                    this.navigator.FitMeshToWindow (meshUserData.originalMeshInstance.id);
                }
            });
            if (this.navigator.MeshItemCount () > 1) {
                let isMeshIsolated = this.navigator.IsMeshIsolated (meshUserData.originalMeshInstance.id);
                items.push ({
                    name : isMeshIsolated ? Loc ('Remove isolation') : Loc ('Isolate mesh'),
                    icon : isMeshIsolated ? 'deisolate' : 'isolate',
                    onClick : () => {
                        if (isMeshIsolated) {
                            this.navigator.ShowAllMeshes (true);
                        } else {
                            this.navigator.IsolateMesh (meshUserData.originalMeshInstance.id);
                        }
                    }
                });
            }
        }
        ShowListPopup (items, {
            calculatePosition : (contentDiv) => {
                return CalculatePopupPositionToScreen (globalMouseCoordinates, contentDiv);
            },
            onClick : (index) => {
                let clickedItem = items[index];
                clickedItem.onClick ();
            }
        });
    }

    OnHashChange ()
    {
        if (this.hashHandler.HasHash ()) {
            let sourceType = this.hashHandler.GetSourceTypeFromHash();
            
            // Check if this is a merged STP file request
            if (sourceType === 'merged') {
                let mergedFiles = null;
                try {
                    // Get merged files from localStorage
                    const mergedFilesJson = localStorage.getItem('mergedStepFiles');
                    if (mergedFilesJson) {
                        mergedFiles = JSON.parse(mergedFilesJson);
                        // Clear localStorage to prevent reloading the same data on refresh
                        localStorage.removeItem('mergedStepFiles');
                    }
                } catch (error) {
                    console.error('Error loading merged files:', error);
                }
                
                if (mergedFiles && mergedFiles.length > 0) {
                    // Process merged files
                    let importSettings = new ImportSettings();
                    importSettings.defaultLineColor = this.settings.defaultLineColor;
                    importSettings.defaultColor = this.settings.defaultColor;
                    
                    // Convert the merged data into input files format
                    let inputFiles = [];
                    for (const file of mergedFiles) {
                        const fileBuffer = Uint8Array.from(atob(file.data), c => c.charCodeAt(0)).buffer;
                        inputFiles.push({
                            name: file.name,
                            extension: file.extension,
                            source: file.source,
                            data: fileBuffer
                        });
                    }
                    
                    HandleEvent('model_load_started', 'merged_stp');
                    this.LoadModelFromInputFiles(inputFiles, importSettings);
                    return;
                }
            }
            
            // Regular URL loading flow
            let urls = this.hashHandler.GetModelFilesFromHash ();
            if (urls === null) {
                return;
            }
            TransformFileHostUrls (urls);
            let importSettings = new ImportSettings ();
            importSettings.defaultLineColor = this.settings.defaultLineColor;
            importSettings.defaultColor = this.settings.defaultColor;
            let defaultColor = this.hashHandler.GetDefaultColorFromHash ();
            if (defaultColor !== null) {
                importSettings.defaultColor = defaultColor;
            }
            HandleEvent ('model_load_started', 'hash');
            this.LoadModelFromUrlList (urls, importSettings);
        } else {
            this.ClearModel ();
            this.SetUIState (WebsiteUIState.Intro);
        }
    }

    OpenFileBrowserDialog ()
    {
        this.parameters.fileInput.click ();
    }

    FitModelToWindow (onLoad)
    {
        let animation = !onLoad;
        let boundingSphere = this.viewer.GetBoundingSphere ((meshUserData) => {
            return this.navigator.IsMeshVisible (meshUserData.originalMeshInstance.id);
        });
        if (onLoad) {
            this.viewer.AdjustClippingPlanesToSphere (boundingSphere);
        }
        this.viewer.FitSphereToWindow (boundingSphere, animation);
    }

    FitMeshToWindow (meshInstanceId)
    {
        let boundingSphere = this.viewer.GetBoundingSphere ((meshUserData) => {
            return meshUserData.originalMeshInstance.id.IsEqual (meshInstanceId);
        });
        this.viewer.FitSphereToWindow (boundingSphere, true);
    }

    FitMeshesToWindow (meshInstanceIdSet)
    {
        let meshInstanceIdKeys = new Set ();
        for (let meshInstanceId of meshInstanceIdSet) {
            meshInstanceIdKeys.add (meshInstanceId.GetKey ());
        }
        let boundingSphere = this.viewer.GetBoundingSphere ((meshUserData) => {
            return meshInstanceIdKeys.has (meshUserData.originalMeshInstance.id.GetKey ());
        });
        this.viewer.FitSphereToWindow (boundingSphere, true);
    }

    UpdateMeshesVisibility ()
    {
        this.viewer.SetMeshesVisibility ((meshUserData) => {
            return this.navigator.IsMeshVisible (meshUserData.originalMeshInstance.id);
        });
    }

    UpdateMeshesSelection ()
    {
        // Check if the navigator has GetAllSelectedMeshIds method (our new multi-selection method)
        if (this.navigator.GetAllSelectedMeshIds) {
            // Get all selected mesh IDs
            const selectedMeshIds = this.navigator.GetAllSelectedMeshIds();
            
            console.log('Highlighting meshes:', selectedMeshIds.size > 0 ? Array.from(selectedMeshIds).map(id => id.GetKey()) : 'none');
            
            // Highlight all selected meshes
            this.viewer.SetMeshesHighlight(this.highlightColor, (meshUserData) => {
                for (const selectedMeshId of selectedMeshIds) {
                    if (meshUserData.originalMeshInstance.id.IsEqual(selectedMeshId)) {
                        return true;
                    }
                }
                return false;
            });
        } else {
            // Fallback to original single-selection behavior
            let selectedMeshId = this.navigator.GetSelectedMeshId();
            this.viewer.SetMeshesHighlight(this.highlightColor, (meshUserData) => {
                if (selectedMeshId !== null && meshUserData.originalMeshInstance.id.IsEqual(selectedMeshId)) {
                    return true;
                }
                return false;
            });
        }
    }
    
    // Create a physical group from selected meshes
    IsolatePhysicalGroup(groupIndex) {
        // Basic validation
        if (!this.model) {
            console.error('Model is not available');
            return false;
        }
        
        if (groupIndex < 0 || groupIndex >= this.model.PhysicalGroupCount()) {
            console.error('Invalid group index:', groupIndex);
            return false;
        }
        
        // Get the group
        const group = this.model.GetPhysicalGroup(groupIndex);
        if (!group) {
            console.error('Could not get group at index:', groupIndex);
            return false;
        }
        
        console.log('Isolating group:', group.GetName());
        
        // First hide all meshes
        this.navigator.meshesPanel.ShowAllMeshes(false);
        
        // Collect all mesh IDs from the group
        const meshIdKeys = Array.from(group.GetMeshes());
        console.log('Group contains meshes:', meshIdKeys);
        
        // Find all mesh instances that need to be visible
        const meshesToShow = [];
        this.model.EnumerateMeshInstances((meshInstance) => {
            const key = meshInstance.GetId().GetKey();
            if (meshIdKeys.includes(key)) {
                meshesToShow.push(meshInstance.GetId());
            }
        });
        
        // Now show each mesh
        for (const meshId of meshesToShow) {
            const meshItem = this.navigator.meshesPanel.GetMeshItem(meshId);
            if (meshItem) {
                meshItem.SetVisible(true, NavigatorItemRecurse.Parents);
            }
        }
        
        // Notify the viewer that mesh visibility has changed
        this.viewer.Render();
        
        return true;
    }
    
    ExportPhysicalGroupAsStl(groupIndex) {
        console.log('Starting export of physical group at index:', groupIndex);
        
        // Basic validation
        if (!this.model) {
            console.error('Model is not available');
            ShowMessageDialog('Export Failed', 'Model is not available');
            return false;
        }
        
        console.log('Model physicalGroups:', this.model.physicalGroups ? this.model.physicalGroups.length : 'none');
        
        if (groupIndex < 0 || groupIndex >= this.model.PhysicalGroupCount()) {
            console.error('Invalid group index:', groupIndex);
            ShowMessageDialog('Export Failed', 'Invalid physical group index');
            return false;
        }
        
        // Get the group
        const group = this.model.GetPhysicalGroup(groupIndex);
        if (!group) {
            console.error('Could not get group at index:', groupIndex);
            ShowMessageDialog('Export Failed', 'Could not find physical group');
            return false;
        }
        
        // Show progress dialog
        const progressDialog = new ProgressDialog();
        progressDialog.Init('Exporting Physical Group');
        progressDialog.Open();
        
        const groupName = group.GetName() || 'Group_' + groupIndex;
        console.log('Exporting group as STL:', groupName);
        console.log('Group meshes:', group.GetMeshes ? Array.from(group.GetMeshes()) : 'No GetMeshes method');
        
        setTimeout(() => {
            try {
                // Export as STL directly
                console.log('Creating TextWriter');
                const textWriter = new TextWriter();
                let triangleCount = 0;
                
                // Start STL text file
                textWriter.WriteLine(`solid ${groupName}`);
                
                // Get all meshes in this group
                const meshKeys = Array.from(group.GetMeshes());
                console.log('Mesh keys in group:', meshKeys);
                
                // Process each mesh in the model
                this.model.EnumerateMeshInstances((meshInstance) => {
                    const meshId = meshInstance.GetId();
                    const meshKey = meshId.GetKey();
                    
                    // Check if this mesh is in our group
                    if (meshKeys.includes(meshKey)) {
                        console.log('Processing mesh:', meshKey);
                        
                        // Get the mesh and potential face indices
                        const mesh = meshInstance.GetMesh();
                        const faceIndices = group.GetMeshFaceIndices(meshId);
                        console.log('Face indices for mesh:', faceIndices ? faceIndices.length : 'none');
                        
                        // Get the transformation matrix
                        const transformation = meshInstance.GetTransformation();
                        
                        // Process triangles
                        for (let i = 0; i < mesh.TriangleCount(); i++) {
                            // If face indices specified, only export those faces
                            if (faceIndices && faceIndices.length > 0 && !faceIndices.includes(i)) {
                                continue; // Skip triangles not in the selected faces
                            }
                            
                            const triangle = mesh.GetTriangle(i);
                            
                            // Get vertex positions
                            let v0 = mesh.GetVertex(triangle.v0);
                            let v1 = mesh.GetVertex(triangle.v1);
                            let v2 = mesh.GetVertex(triangle.v2);
                            
                            // Apply transformation if needed
                            if (transformation && !transformation.IsIdentity()) {
                                v0 = transformation.TransformCoord3D(v0);
                                v1 = transformation.TransformCoord3D(v1);
                                v2 = transformation.TransformCoord3D(v2);
                            }
                            
                            // Calculate normal from vertices
                            const ux = v1.x - v0.x;
                            const uy = v1.y - v0.y;
                            const uz = v1.z - v0.z;
                            
                            const vx = v2.x - v0.x;
                            const vy = v2.y - v0.y;
                            const vz = v2.z - v0.z;
                            
                            let nx = uy * vz - uz * vy;
                            let ny = uz * vx - ux * vz;
                            let nz = ux * vy - uy * vx;
                            
                            // Normalize the normal
                            const normalLength = Math.sqrt(nx * nx + ny * ny + nz * nz);
                            if (normalLength > 0) {
                                nx /= normalLength;
                                ny /= normalLength;
                                nz /= normalLength;
                            }
                            
                            // Write facet
                            textWriter.WriteArrayLine(['facet', 'normal', nx, ny, nz]);
                            textWriter.Indent(1);
                            textWriter.WriteLine('outer loop');
                            textWriter.Indent(1);
                            textWriter.WriteArrayLine(['vertex', v0.x, v0.y, v0.z]);
                            textWriter.WriteArrayLine(['vertex', v1.x, v1.y, v1.z]);
                            textWriter.WriteArrayLine(['vertex', v2.x, v2.y, v2.z]);
                            textWriter.Indent(-1);
                            textWriter.WriteLine('endloop');
                            textWriter.Indent(-1);
                            textWriter.WriteLine('endfacet');
                            
                            triangleCount++;
                        }
                    }
                });
                
                textWriter.WriteLine(`endsolid ${groupName}`);
                console.log('Total triangles written:', triangleCount);
                
                if (triangleCount > 0) {
                    // Download as STL
                    const stlContent = textWriter.GetText();
                    // Convert text to a downloadable form
                    const sanitizedName = groupName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    console.log('Downloading file as:', sanitizedName + '.stl');
                    
                    // Create a direct file download using a data URL
                    // This is a more direct approach that avoids potential issues with blob URLs
                    const dataUri = 'data:text/plain;charset=utf-8,' + encodeURIComponent(stlContent);
                    
                    try {
                        // Create a hidden anchor element
                        const link = document.createElement('a');
                        link.setAttribute('href', dataUri);
                        link.setAttribute('download', sanitizedName + '.stl');
                        link.style.display = 'none';
                        
                        // Add to document, click and remove
                        document.body.appendChild(link);
                        console.log('Triggering download...');
                        link.click();
                        
                        // Clean up
                        setTimeout(() => {
                            document.body.removeChild(link);
                            progressDialog.Close();
                            console.log('Download process completed.');
                        }, 100);
                    } catch (downloadError) {
                        console.error('Download error:', downloadError);
                        progressDialog.Close();
                        ShowMessageDialog('Export Failed', 'Failed to initiate download: ' + downloadError.message);
                    }
                } else {
                    progressDialog.Close();
                    throw new Error('No triangles in this physical group');
                }
            } catch (error) {
                progressDialog.Close();
                console.error('Error exporting physical group:', error);
                ShowMessageDialog('Export Failed', 'Error while exporting: ' + error.message);
            }
        }, 100); // Small delay to ensure dialog is shown first
        
        return true;
    }
    
    // Helper to create a model filtered to just one physical group
    CreateFilteredModelFromGroup(group) {
        // Create a new model
        const filteredModel = new this.model.constructor();
        
        // Get meshes from the group
        const meshKeys = Array.from(group.GetMeshes());
        
        // Copy all materials
        for (let i = 0; i < this.model.MaterialCount(); i++) {
            const material = this.model.GetMaterial(i);
            // Skip cloning as it might not be available
            filteredModel.AddMaterial(material);
        }
        
        // For each mesh in the group, add it to the filtered model
        this.model.EnumerateMeshInstances((meshInstance) => {
            const meshId = meshInstance.GetId();
            if (group.ContainsMesh(meshId)) {
                const mesh = meshInstance.GetMesh();
                const faceIndices = group.GetMeshFaceIndices(meshId);
                
                // If no specific faces, clone the whole mesh
                if (!faceIndices || faceIndices.length === 0) {
                    // Create a new mesh instead of cloning
                    const clonedMesh = new mesh.constructor();
                    
                    // Copy vertices, normals, UVs
                    for (let i = 0; i < mesh.VertexCount(); i++) {
                        clonedMesh.AddVertex(mesh.GetVertex(i));
                    }
                    
                    if (mesh.NormalCount() > 0) {
                        for (let i = 0; i < mesh.NormalCount(); i++) {
                            clonedMesh.AddNormal(mesh.GetNormal(i));
                        }
                    }
                    
                    if (mesh.TextureUVCount() > 0) {
                        for (let i = 0; i < mesh.TextureUVCount(); i++) {
                            clonedMesh.AddTextureUV(mesh.GetTextureUV(i));
                        }
                    }
                    
                    // Copy triangles
                    for (let i = 0; i < mesh.TriangleCount(); i++) {
                        const triangle = mesh.GetTriangle(i);
                        clonedMesh.AddTriangle(
                            triangle.v0, triangle.v1, triangle.v2,
                            triangle.n0, triangle.n1, triangle.n2,
                            triangle.mat
                        );
                    }
                    // First add the mesh to the filtered model
                    const meshIndex = filteredModel.AddMesh(clonedMesh);
                    // Then add mesh index to the root node
                    filteredModel.GetRootNode().AddMeshIndex(meshIndex);
                } else {
                    // Create a new mesh with only the specified faces
                    const clonedMesh = new mesh.constructor();
                    
                    // Copy vertices, normals, UVs
                    for (let i = 0; i < mesh.VertexCount(); i++) {
                        clonedMesh.AddVertex(mesh.GetVertex(i));
                    }
                    
                    if (mesh.NormalCount() > 0) {
                        for (let i = 0; i < mesh.NormalCount(); i++) {
                            clonedMesh.AddNormal(mesh.GetNormal(i));
                        }
                    }
                    
                    if (mesh.TextureUVCount() > 0) {
                        for (let i = 0; i < mesh.TextureUVCount(); i++) {
                            clonedMesh.AddTextureUV(mesh.GetTextureUV(i));
                        }
                    }
                    
                    // Add only the specified triangles
                    for (const faceIndex of faceIndices) {
                        const triangle = mesh.GetTriangle(faceIndex);
                        clonedMesh.AddTriangle(
                            triangle.v0, triangle.v1, triangle.v2,
                            triangle.n0, triangle.n1, triangle.n2,
                            triangle.mat
                        );
                    }
                    
                    // Add the mesh to the model
                    if (clonedMesh.TriangleCount() > 0) {
                        const meshIndex = filteredModel.AddMesh(clonedMesh);
                        filteredModel.GetRootNode().AddMeshIndex(meshIndex);
                    }
                }
            }
        });
        
        return filteredModel;
    }
    
    ShowPhysicalGroupsDialog() {
        // Check if there are any physical groups
        if (!this.model || !this.model.physicalGroups || this.model.physicalGroups.length === 0) {
            ShowMessageDialog('Physical Groups', 'There are no physical groups in this model.');
            return;
        }

        // Create dialog
        const dialog = new ButtonDialog();
        const contentDiv = dialog.Init('Physical Groups', [
            {
                name: 'Close',
                onClick: () => {
                    dialog.Close();
                }
            },
            {
                name: 'Export Selected Groups',
                onClick: () => {
                    dialog.Close();
                    ShowExportDialog(this.model, this.viewer, {
                        isMeshVisible: (meshInstanceId) => {
                            return this.navigator.IsMeshVisible(meshInstanceId);
                        }
                    });
                }
            }
        ]);

        // Add header text
        AddDiv(contentDiv, 'ov_dialog_message', 'Select a physical group to isolate:');

        // Create container for group list
        const groupsContainer = AddDiv(contentDiv, 'ov_dialog_group_list');
        groupsContainer.style.maxHeight = '300px';
        groupsContainer.style.overflowY = 'auto';
        groupsContainer.style.border = '1px solid #ddd';
        groupsContainer.style.padding = '5px';
        groupsContainer.style.marginTop = '10px';
        groupsContainer.style.marginBottom = '10px';

        // Add each physical group
        const physicalGroups = this.model.physicalGroups; 
        for (let i = 0; i < physicalGroups.length; i++) {
            const group = physicalGroups[i];
            
            // Skip invalid groups
            if (!group) {
                console.log(`Skipping invalid group at index ${i}`);
                continue;
            }
            
            const groupRow = AddDiv(groupsContainer, 'ov_dialog_group_row');
            groupRow.style.padding = '8px';
            groupRow.style.cursor = 'pointer';
            groupRow.style.borderBottom = '1px solid #eee';
            groupRow.style.display = 'flex';
            groupRow.style.justifyContent = 'space-between';
            groupRow.style.alignItems = 'center';

            // Group name
            const groupName = AddDiv(groupRow, 'ov_dialog_group_name', group.GetName());
            groupName.style.flex = '1';

            // Mesh count
            const meshCount = group.MeshCount();
            const meshCountText = meshCount === 1 ? '1 mesh' : `${meshCount} meshes`;
            AddDiv(groupRow, 'ov_dialog_group_info', meshCountText);

            // Add isolate button - capture current index in closure
            const currentIndex = i;
            const isolateButton = document.createElement('button');
            isolateButton.textContent = 'Isolate';
            isolateButton.className = 'ov_button outline';
            isolateButton.style.marginLeft = '10px';
            isolateButton.onclick = (event) => {
                event.stopPropagation();
                dialog.Close();
                this.IsolatePhysicalGroup(currentIndex);
            };
            groupRow.appendChild(isolateButton);
            
            // Add a direct export button
            const exportButton = document.createElement('button');
            exportButton.textContent = 'Export STL';
            exportButton.className = 'ov_button outline';
            exportButton.style.marginLeft = '10px';
            exportButton.onclick = (event) => {
                event.stopPropagation();
                dialog.Close();
                
                // First isolate this group so the user can see what they're exporting
                this.IsolatePhysicalGroup(currentIndex);
                
                // Open the export dialog with this group pre-selected
                ShowExportDialog(this.model, this.viewer, {
                    isMeshVisible: (meshInstanceId) => {
                        return this.navigator.IsMeshVisible(meshInstanceId);
                    }
                });
            };
            groupRow.appendChild(exportButton);

            // Make the whole row clickable to isolate - also capture current index
            groupRow.onclick = () => {
                dialog.Close();
                this.IsolatePhysicalGroup(currentIndex);
            };
        }

        // Add "Show All" button at the bottom
        const showAllDiv = AddDiv(contentDiv, 'ov_dialog_show_all');
        showAllDiv.style.textAlign = 'center';
        showAllDiv.style.marginTop = '10px';

        const showAllButton = document.createElement('button');
        showAllButton.textContent = 'Show All Meshes';
        showAllButton.className = 'ov_button';
        showAllButton.onclick = () => {
            this.navigator.ShowAllMeshes(true);
            this.callbacks.onMeshVisibilityChanged();
            dialog.Close();
        };
        showAllDiv.appendChild(showAllButton);

        dialog.Open();
    }

    CreatePhysicalGroupFromSelectedFaces ()
    {
        console.log('Creating physical group from selected meshes');
        
        // Get the selected meshes
        const selectedMeshes = this.navigator.GetAllSelectedMeshIds();
        console.log('Selected meshes:', selectedMeshes.size);
        
        if (selectedMeshes.size === 0) {
            ShowMessageDialog('Create Physical Group', 'No meshes selected. Please select at least one mesh.');
            return;
        }
        
        // Default group name
        const defaultGroupName = 'Group_' + (this.model && this.model.PhysicalGroupCount ? this.model.PhysicalGroupCount() + 1 : 1);
        
        // Create and show the dialog
        const dialog = new ButtonDialog();
        const contentDiv = dialog.Init('Create Physical Group', [
            {
                name: 'Create',
                onClick: () => {
                    const groupNameInput = document.getElementById('physicalGroupNameInput');
                    const groupName = groupNameInput ? groupNameInput.value.trim() : defaultGroupName;
                    
                    if (!groupName) {
                        ShowMessageDialog('Error', 'Please enter a group name.');
                        return;
                    }
                    
                    // Check if physical groups functionality exists
                    if (!this.model || !this.model.AddPhysicalGroup) {
                        console.error('Physical groups functionality not available');
                        ShowMessageDialog('Error', 'Physical groups functionality not available in this model.');
                        dialog.Close();
                        return;
                    }
                    
                    // Check if group name already exists
                    if (this.model.FindPhysicalGroupByName && this.model.FindPhysicalGroupByName(groupName)) {
                        ShowMessageDialog('Error', 'A group with this name already exists. Please choose a different name.');
                        return;
                    }
                    
                    try {
                        // Create the physical group
                        const physicalGroup = this.model.AddPhysicalGroup(groupName);
                        console.log('Created physical group:', groupName);
                        
                        let addedMeshCount = 0;
                        
                        // Add all selected meshes to the group
                        for (const meshId of selectedMeshes) {
                            try {
                                // Add the mesh to the group
                                physicalGroup.AddMesh(meshId);
                                addedMeshCount++;
                                
                                // Try to get triangle data if available
                                try {
                                    const meshInstance = this.model.GetMeshInstance(meshId);
                                    if (meshInstance && meshInstance.GetMesh) {
                                        const mesh = meshInstance.GetMesh();
                                        if (mesh && mesh.TriangleCount) {
                                            // For each triangle in the mesh, add its index to the group
                                            const triangleCount = mesh.TriangleCount();
                                            console.log(`Adding ${triangleCount} triangles from mesh ${meshId.GetKey()}`);
                                            for (let i = 0; i < triangleCount; i++) {
                                                physicalGroup.AddMeshWithIndex(meshId, i);
                                            }
                                        }
                                    }
                                } catch (e) {
                                    console.warn('Could not add triangles for mesh:', meshId.GetKey(), e);
                                }
                            } catch (e) {
                                console.error('Error adding mesh to group:', e);
                            }
                        }
                        
                        // Close the dialog
                        dialog.Close();
                        
                        // Show success message
                        ShowMessageDialog('Success', `Created physical group "${groupName}" with ${addedMeshCount} meshes.`);
                        console.log(`Physical group created: ${groupName} with ${addedMeshCount} meshes`);
                        
                        // Debug info
                        console.log('Current physical groups:', this.model.PhysicalGroupCount());
                        this.model.EnumeratePhysicalGroups(group => {
                            console.log(`- Group: ${group.GetName()}, Meshes: ${group.MeshCount()}`);
                        });
                        
                    } catch (e) {
                        console.error('Error creating physical group:', e);
                        ShowMessageDialog('Error', 'Error creating physical group: ' + e.message);
                        dialog.Close();
                    }
                }
            },
            {
                name: 'Cancel',
                onClick: () => {
                    dialog.Close();
                }
            }
        ]);
        
        // Add text explaining the purpose
        AddDiv(contentDiv, 'ov_dialog_message', 'Enter a name for the physical group:');
        
        // Add input for group name
        const inputContainerDiv = AddDiv(contentDiv, 'ov_dialog_section');
        const groupNameInput = document.createElement('input');
        groupNameInput.setAttribute('type', 'text');
        groupNameInput.setAttribute('id', 'physicalGroupNameInput');
        groupNameInput.setAttribute('value', defaultGroupName);
        groupNameInput.style.width = '100%';
        groupNameInput.style.padding = '5px';
        groupNameInput.style.marginTop = '10px';
        groupNameInput.style.boxSizing = 'border-box';
        groupNameInput.style.border = '1px solid #ccc';
        groupNameInput.style.borderRadius = '3px';
        inputContainerDiv.appendChild(groupNameInput);
        
        // Open the dialog
        dialog.Open();
    }
    
    // Show a notification message
    ShowNotification (message)
    {
        const notificationDiv = AddDiv(document.body, 'ov_notification');
        notificationDiv.innerHTML = message;
        
        // Auto-hide after 3 seconds
        setTimeout(() => {
            document.body.removeChild(notificationDiv);
        }, 3000);
    }

    LoadModelFromUrlList (urls, settings)
    {
        let inputFiles = InputFilesFromUrls (urls);
        this.LoadModelFromInputFiles (inputFiles, settings);
        this.ClearHashIfNotOnlyUrlList ();
    }

    LoadModelFromFileList (files)
    {
        let importSettings = new ImportSettings ();
        importSettings.defaultLineColor = this.settings.defaultLineColor;
        importSettings.defaultColor = this.settings.defaultColor;
        let inputFiles = InputFilesFromFileObjects (files);
        this.LoadModelFromInputFiles (inputFiles, importSettings);
        this.ClearHashIfNotOnlyUrlList ();
    }

    LoadModelFromInputFiles (files, settings)
    {
        this.modelLoaderUI.LoadModel (files, settings, {
            onStart : () =>
            {
                this.SetUIState (WebsiteUIState.Loading);
                this.ClearModel ();
            },
            onFinish : (importResult, threeObject) =>
            {
                this.SetUIState (WebsiteUIState.Model);
                this.OnModelLoaded (importResult, threeObject);
                let importedExtension = GetFileExtension (importResult.mainFile);
                HandleEvent ('model_loaded', importedExtension);
            },
            onRender : () =>
            {
                this.viewer.Render ();
            },
            onError : (importError) =>
            {
                this.SetUIState (WebsiteUIState.Intro);
                let extensionStr = null;
                if (importError.mainFile !== null) {
                    extensionStr = GetFileExtension (importError.mainFile);
                } else {
                    let extensions = [];
                    let importer = this.modelLoaderUI.GetImporter ();
                    let fileList = importer.GetFileList ().GetFiles ();
                    for (let i = 0; i < fileList.length; i++) {
                        let extension = fileList[i].extension;
                        extensions.push (extension);
                    }
                    extensionStr = extensions.join (',');
                }
                if (importError.code === ImportErrorCode.NoImportableFile) {
                    HandleEvent ('no_importable_file', extensionStr);
                } else if (importError.code === ImportErrorCode.FailedToLoadFile) {
                    HandleEvent ('failed_to_load_file', extensionStr);
                } else if (importError.code === ImportErrorCode.ImportFailed) {
                    HandleEvent ('import_failed', extensionStr, {
                        error_message : importError.message
                    });
                }
            }
        });
    }

    ClearHashIfNotOnlyUrlList ()
    {
        let importer = this.modelLoaderUI.GetImporter ();
        let isOnlyUrl = importer.GetFileList ().IsOnlyUrlSource ();
        if (!isOnlyUrl && this.hashHandler.HasHash ()) {
            this.hashHandler.SkipNextEventHandler ();
            this.hashHandler.ClearHash ();
        }
    }

    UpdateEdgeDisplay ()
    {
        this.settings.SaveToCookies ();
        this.viewer.SetEdgeSettings (this.settings.edgeSettings);
    }

    UpdateEnvironmentMap ()
    {
        let envMapPath = 'assets/envmaps/' + this.settings.environmentMapName + '/';
        let envMapTextures = [
            envMapPath + 'posx.jpg',
            envMapPath + 'negx.jpg',
            envMapPath + 'posy.jpg',
            envMapPath + 'negy.jpg',
            envMapPath + 'posz.jpg',
            envMapPath + 'negz.jpg'
        ];
        let environmentSettings = new EnvironmentSettings (envMapTextures, this.settings.backgroundIsEnvMap);
        this.viewer.SetEnvironmentMapSettings (environmentSettings);
    }

    SwitchTheme (newThemeId, resetColors)
    {
        this.settings.themeId = newThemeId;
        this.themeHandler.SwitchTheme (this.settings.themeId);
        if (resetColors) {
            let defaultSettings = new Settings (this.settings.themeId);
            this.settings.backgroundColor = defaultSettings.backgroundColor;
            this.settings.defaultLineColor = defaultSettings.defaultLineColor;
            this.settings.defaultColor = defaultSettings.defaultColor;
            this.sidebar.UpdateControlsStatus ();

            this.viewer.SetBackgroundColor (this.settings.backgroundColor);
            let modelLoader = this.modelLoaderUI.GetModelLoader ();
            if (modelLoader.GetDefaultMaterials () !== null) {
                ReplaceDefaultMaterialsColor (this.model, this.settings.defaultColor, this.settings.defaultLineColor);
                modelLoader.ReplaceDefaultMaterialsColor (this.settings.defaultColor, this.settings.defaultLineColor);
            }
        }

        this.settings.SaveToCookies ();
    }

    InitViewer ()
    {
        let canvas = AddDomElement (this.parameters.viewerDiv, 'canvas');
        this.viewer.Init (canvas);
        this.viewer.SetEdgeSettings (this.settings.edgeSettings);
        this.viewer.SetBackgroundColor (this.settings.backgroundColor);
        this.viewer.SetNavigationMode (this.cameraSettings.navigationMode);
        this.viewer.SetProjectionMode (this.cameraSettings.projectionMode);
        this.UpdateEnvironmentMap ();
    }

    InitToolbar ()
    {
        function AddButton (toolbar, imageName, imageTitle, classNames, onClick)
        {
            let button = toolbar.AddImageButton (imageName, imageTitle, () => {
                onClick ();
            });
            for (let className of classNames) {
                button.AddClass (className);
            }
            return button;
        }

        function AddSeparator (toolbar, classNames)
        {
            let separator = toolbar.AddSeparator ();
            if (classNames !== null) {
                for (let className of classNames) {
                    separator.classList.add (className);
                }
            }
        }

        // Only add Open button to load models
        AddButton (this.toolbar, 'open', Loc ('Open from your device'), [], () => {
            this.OpenFileBrowserDialog ();
        });
        
        // Add separator for model-dependent buttons
        AddSeparator (this.toolbar, ['only_on_model']);
        
        // Add button for creating physical groups
        AddButton (this.toolbar, 'model', Loc ('Create Physical Group'), ['only_on_model'], () => {
            this.CreatePhysicalGroupFromSelectedFaces();
        });
        
        // Add button for managing physical groups
        AddButton (this.toolbar, 'meshes', Loc ('Physical Groups'), ['only_on_model'], () => {
            this.ShowPhysicalGroupsDialog();
        });
        
        // Add export button
        AddButton (this.toolbar, 'export', Loc ('Export'), ['only_on_model'], () => {
            ShowExportDialog (this.model, this.viewer, {
                isMeshVisible : (meshInstanceId) => {
                    return this.navigator.IsMeshVisible (meshInstanceId);
                }
            });
        });
        
        // Add simulate button
        AddButton (this.toolbar, 'print3d', Loc ('Simulate'), ['only_on_model'], () => {
            // Check if the model has physical groups
            if (!this.model || !this.model.physicalGroups || this.model.physicalGroups.length === 0) {
                ShowMessageDialog('Simulate', 'There are no physical groups in this model.');
                return;
            }
            
            // Show progress dialog
            const progressDialog = new ProgressDialog();
            progressDialog.Init('Simulating Physical Groups');
            progressDialog.Open();
            
            // Create export settings with all physical groups selected
            const settings = new ExporterSettings();
            settings.exportPhysicalGroups = true;
            settings.selectedGroups = [];
            
            // Select all physical groups
            for (let i = 0; i < this.model.physicalGroups.length; i++) {
                settings.selectedGroups.push(i);
            }
            
            // Create exporter
            const exporter = new Exporter();
            
            // Export as GLB
            exporter.Export(this.model, settings, FileFormat.Binary, 'glb', {
                onError: () => {
                    progressDialog.Close();
                    ShowMessageDialog('Simulation Error', 'Failed to export physical groups.');
                },
                onSuccess: (files) => {
                    if (files.length > 0) {
                        progressDialog.SetText('Saving files to server...');
                        
                        // We need to save these files to the server's temp directory
                        // Create a FormData to send the files
                        const formData = new FormData();
                        
                        // Add each file to the form data
                        for (let i = 0; i < files.length; i++) {
                            const file = files[i];
                            const blob = new Blob([file.content], { type: 'application/octet-stream' });
                            
                            // Use physical group names as filenames if available
                            let fileName = file.name;
                            if (i < settings.selectedGroups.length && this.model.physicalGroups[settings.selectedGroups[i]]) {
                                const group = this.model.physicalGroups[settings.selectedGroups[i]];
                                const groupName = group.GetName ? group.GetName() : (group.name || `Group_${settings.selectedGroups[i]}`);
                                const sanitizedName = groupName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                                fileName = `${sanitizedName}.glb`;
                            }
                            
                            formData.append(`file${i}`, blob, fileName);
                        }
                        
                        // Upload all files to temp directory using existing route
                        const xhr = new XMLHttpRequest();
                        xhr.open('POST', '/api/upload', true);
                        
                        xhr.onload = () => {
                            progressDialog.Close();
                            if (xhr.status === 200) {
                                // Show success message
                                ShowMessageDialog('Simulation Complete', 
                                    `Exported ${files.length} files for ${this.model.physicalGroups.length} physical groups to server.`);
                                console.log('Server response:', xhr.responseText);
                            } else {
                                ShowMessageDialog('Server Error', 
                                    `Files were exported but failed to save to server: ${xhr.status} ${xhr.statusText}`);
                            }
                        };
                        
                        xhr.onerror = () => {
                            progressDialog.Close();
                            ShowMessageDialog('Server Error', 'Network error while saving files to server.');
                        };
                        
                        xhr.send(formData);
                    } else {
                        progressDialog.Close();
                        ShowMessageDialog('Simulation Error', 'No files were exported.');
                    }
                }
            });
        });

        // Keep file input event handler for opening files
        this.parameters.fileInput.addEventListener ('change', (ev) => {
            if (ev.target.files.length > 0) {
                HandleEvent ('model_load_started', 'open_file');
                this.LoadModelFromFileList (ev.target.files);
            }
        });
    }

    InitDragAndDrop ()
    {
        window.addEventListener ('dragstart', (ev) => {
            ev.preventDefault ();
        }, false);

        window.addEventListener ('dragover', (ev) => {
            ev.stopPropagation ();
            ev.preventDefault ();
            ev.dataTransfer.dropEffect = 'copy';
        }, false);

        window.addEventListener ('drop', (ev) => {
            ev.stopPropagation ();
            ev.preventDefault ();
            GetFilesFromDataTransfer (ev.dataTransfer, (files) => {
                if (files.length > 0) {
                    HandleEvent ('model_load_started', 'drop');
                    this.LoadModelFromFileList (files);
                }
            });
        }, false);
    }

    InitSidebar ()
    {
        this.sidebar.Init ({
            getShadingType : () => {
                return this.viewer.GetShadingType ();
            },
            getProjectionMode : () => {
                return this.viewer.GetProjectionMode ();
            },
            getDefaultMaterials : () => {
                return GetDefaultMaterials (this.model);
            },
            onEnvironmentMapChanged : () => {
                this.settings.SaveToCookies ();
                this.UpdateEnvironmentMap ();
                if (this.measureTool.IsActive ()) {
                    this.measureTool.UpdatePanel ();
                }
            },
            onBackgroundColorChanged : () => {
                this.settings.SaveToCookies ();
                this.viewer.SetBackgroundColor (this.settings.backgroundColor);
                if (this.measureTool.IsActive ()) {
                    this.measureTool.UpdatePanel ();
                }
            },
            onDefaultColorChanged : () => {
                this.settings.SaveToCookies ();
                let modelLoader = this.modelLoaderUI.GetModelLoader ();
                if (modelLoader.GetDefaultMaterials () !== null) {
                    ReplaceDefaultMaterialsColor (this.model, this.settings.defaultColor, this.settings.defaultLineColor);
                    modelLoader.ReplaceDefaultMaterialsColor (this.settings.defaultColor, this.settings.defaultLineColor);
                }
                this.viewer.Render ();
            },
            onEdgeDisplayChanged : () => {
                HandleEvent ('edge_display_changed', this.settings.showEdges ? 'on' : 'off');
                this.UpdateEdgeDisplay ();
            },
            onResizeRequested : () => {
                this.layouter.Resize ();
            },
            onShowHidePanels : (show) => {
                ShowDomElement (this.parameters.sidebarSplitterDiv, show);
                CookieSetBoolVal ('ov_show_sidebar', show);
            }
        });
    }

    InitNavigator ()
    {
        function GetMeshUserDataArray (viewer, meshInstanceId)
        {
            let userDataArr = [];
            viewer.EnumerateMeshesAndLinesUserData ((meshUserData) => {
                if (meshUserData.originalMeshInstance.id.IsEqual (meshInstanceId)) {
                    userDataArr.push (meshUserData);
                }
            });
            return userDataArr;
        }

        function GetMeshesForMaterial (viewer, materialIndex)
        {
            let usedByMeshes = [];
            viewer.EnumerateMeshesAndLinesUserData ((meshUserData) => {
                if (materialIndex === null || meshUserData.originalMaterials.indexOf (materialIndex) !== -1) {
                    usedByMeshes.push (meshUserData.originalMeshInstance);
                }
            });
            return usedByMeshes;
        }

        function GetMaterialReferenceInfo (model, materialIndex)
        {
            const material = model.GetMaterial (materialIndex);
            return {
                index : materialIndex,
                name : material.name,
                color : material.color.Clone ()
            };
        }

        function GetMaterialsForMesh (viewer, model, meshInstanceId)
        {
            let usedMaterials = [];
            if (meshInstanceId === null) {
                for (let materialIndex = 0; materialIndex < model.MaterialCount (); materialIndex++) {
                    usedMaterials.push (GetMaterialReferenceInfo (model, materialIndex));
                }
            } else {
                let userDataArr = GetMeshUserDataArray (viewer, meshInstanceId);
                let addedMaterialIndices = new Set ();
                for (let userData of userDataArr) {
                    for (let materialIndex of userData.originalMaterials) {
                        if (addedMaterialIndices.has (materialIndex)) {
                            continue;
                        }
                        usedMaterials.push (GetMaterialReferenceInfo (model, materialIndex));
                        addedMaterialIndices.add (materialIndex);
                    }
                }
            }
            usedMaterials.sort ((a, b) => {
                return a.index - b.index;
            });
            return usedMaterials;
        }

        this.navigator.Init ({
            openFileBrowserDialog : () => {
                this.OpenFileBrowserDialog ();
            },
            fitMeshToWindow : (meshInstanceId) => {
                this.FitMeshToWindow (meshInstanceId);
            },
            fitMeshesToWindow : (meshInstanceIdSet) => {
                this.FitMeshesToWindow (meshInstanceIdSet);
            },
            getMeshesForMaterial : (materialIndex) => {
                return GetMeshesForMaterial (this.viewer, materialIndex);
            },
            getMaterialsForMesh : (meshInstanceId) => {
                return GetMaterialsForMesh (this.viewer, this.model, meshInstanceId);
            },
            onMeshVisibilityChanged : () => {
                this.UpdateMeshesVisibility ();
            },
            onMeshSelectionChanged : () => {
                this.UpdateMeshesSelection ();
            },
            onSelectionCleared : () => {
                this.sidebar.AddObject3DProperties (this.model, this.model);
            },
            onMeshSelected : (meshInstanceId) => {
                let meshInstance = this.model.GetMeshInstance (meshInstanceId);
                this.sidebar.AddObject3DProperties (this.model, meshInstance);
            },
            onMaterialSelected : (materialIndex) => {
                this.sidebar.AddMaterialProperties (this.model.GetMaterial (materialIndex));
            },
            onResizeRequested : () => {
                this.layouter.Resize ();
            },
            onShowHidePanels : (show) => {
                ShowDomElement (this.parameters.navigatorSplitterDiv, show);
                CookieSetBoolVal ('ov_show_navigator', show);
            }
        });
    }

    UpdatePanelsVisibility ()
    {
        // Always hide both panels
        this.navigator.ShowPanels (false);
        this.sidebar.ShowPanels (false);
    }

    CreateHeaderButton (icon, title, link)
    {
        let buttonLink = CreateDomElement ('a');
        buttonLink.setAttribute ('href', link);
        buttonLink.setAttribute ('target', '_blank');
        buttonLink.setAttribute ('rel', 'noopener noreferrer');
        InstallTooltip (buttonLink, title);
        AddSvgIconElement (buttonLink, icon, 'header_button');
        this.parameters.headerButtonsDiv.appendChild (buttonLink);
        return buttonLink;
    }

    InitCookieConsent ()
    {
        let accepted = CookieGetBoolVal ('ov_cookie_consent', false);
        if (accepted) {
            return;
        }

        let text = Loc ('This website uses cookies to offer you better user experience. See the details at the <a target="_blank" href="info/cookies.html">Cookies Policy</a> page.');
        let popupDiv = AddDiv (document.body, 'ov_bottom_floating_panel');
        AddDiv (popupDiv, 'ov_floating_panel_text', text);
        let acceptButton = AddDiv (popupDiv, 'ov_button ov_floating_panel_button', Loc ('Accept'));
        acceptButton.addEventListener ('click', () => {
            CookieSetBoolVal ('ov_cookie_consent', true);
            popupDiv.remove ();
        });
    }
}
