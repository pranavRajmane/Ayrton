// IGES format converter JSHINT rule for regex
import express from 'express';
import bodyParser from 'body-parser';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import multer from 'multer';
// Get dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 8083; // Changed port to avoid conflicts
// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}
// Use CORS middleware with options
const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition'],
    credentials: false,
    preflightContinue: false,
    optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
// Handle OPTIONS requests explicitly
app.options('*', (req, res) => {
    res.status(204).end();
});
// Serve static files from the main directory
app.use(express.static(__dirname));
// Make sure the temp directory is accessible
app.use('/temp', express.static(tempDir));
// Add additional logging for debugging
app.use((req, res, next) => {
    if (req.path.startsWith('/temp')) {
        console.log(`Accessing temp file: ${req.path}`);
        const fullPath = path.join(tempDir, path.basename(req.path));
        console.log(`Full path: ${fullPath}, Exists: ${fs.existsSync(fullPath)}`);
    }
    next();
});
// Parse JSON bodies with increased limit
app.use(bodyParser.json({ limit: '500mb' }));
// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        // Create a unique filename
        const uniqueId = uuidv4();
        cb(null, 'model_' + uniqueId + path.extname(file.originalname));
    }
});
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Accept STP/STEP, IGES, and GLB files
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext === '.stp' || ext === '.step' || ext === '.igs' || ext === '.iges' || ext === '.glb') {
            cb(null, true);
        } else {
            cb(new Error('Only STP/STEP, IGES, or GLB files are allowed'));
        }
    }
});
// GET handler for API documentation
app.get('/api/convert-to-iges', (req, res) => {
    res.status(200).json({
        message: 'IGES Conversion API is running. This endpoint accepts POST requests only.',
        usage: 'Send a POST request with vertices, triangles, and physicalGroups in the request body'
    });
});
// API endpoint for STL export with physical groups using FreeCAD
app.post('/api/export-stl', (req, res) => {
    // Set long timeout for large models
    res.setTimeout(300000); // 5 minute timeout

    try {
        const { vertices, triangles, physicalGroups, selectedGroups } = req.body;

        if (!vertices || !triangles || !physicalGroups) {
            return res.status(400).json({ error: 'Missing required data' });
        }

        console.log(`Received model with ${vertices.length / 3} vertices, ${triangles.length / 3} triangles, and ${physicalGroups.length} groups`);
        console.log(`Selected groups: ${selectedGroups}`);

        // Create unique IDs for input and output files
        const sessionId = uuidv4();
        const inputFile = path.join(tempDir, `model_${sessionId}.json`);
        const outputFile = path.join(tempDir, `model_${sessionId}.stl`);

        // Save model data to JSON file
        fs.writeFileSync(inputFile, JSON.stringify({
            vertices,
            triangles,
            physicalGroups,
            selectedGroups
        }));

        console.log('Model data saved to JSON file, executing GLB-to-STL conversion script...');

        // Execute Python script to export STL via GLB conversion
        console.log(`Executing Python script: python3 tools/stl_exporter/glb_to_stl_exporter.py ${inputFile} ${outputFile}`);

        const childProcess = exec(`python3 tools/stl_exporter/glb_to_stl_exporter.py ${inputFile} ${outputFile}`, {
            timeout: 300000,
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
        }, (error, stdout, stderr) => {
            console.log(`Python script stdout: ${stdout}`);

            if (error) {
                console.error(`Error executing Python script: ${error.message}`);
                console.error(`stderr: ${stderr}`);
                // Clean up the input file even on error
                if (fs.existsSync(inputFile)) {
                    try { fs.unlinkSync(inputFile); } catch (e) { console.error(`Failed to delete input file: ${e}`); }
                }

                // Create a placeholder file if the output file doesn't exist
                if (!fs.existsSync(outputFile)) {
                    try {
                        fs.writeFileSync(outputFile, 'solid EmptyModel\nendsolid EmptyModel\n');
                        console.log('Created fallback STL file due to error');
                    } catch (e) {
                        console.error(`Failed to create fallback file: ${e}`);
                        return res.status(500).json({ error: 'Failed to generate STL file', details: stderr });
                    }
                }

                return res.status(500).json({ error: 'Failed to convert model', details: stderr });
            }

            console.log(`Python script completed: ${stdout}`);

            // Check if output file exists
            if (!fs.existsSync(outputFile)) {
                // Clean up the input file
                if (fs.existsSync(inputFile)) {
                    try { fs.unlinkSync(inputFile); } catch (e) { console.error(`Failed to delete input file: ${e}`); }
                }
                return res.status(500).json({ error: 'Failed to generate STL file' });
            }

            console.log(`Sending STL file: ${outputFile}`);

            // Send file to client
            res.download(outputFile, 'model.stl', (err) => {
                if (err) {
                    console.error(`Download error: ${err}`);
                }

                // Clean up temporary files
                try {
                    if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
                    if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
                    console.log('Temporary files cleaned up');
                } catch (e) {
                    console.error(`Cleanup error: ${e}`);
                }
            });
        });
    } catch (err) {
        console.error(`Server error: ${err}`);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});


// API endpoint to convert model to IGES with physical groups
app.post('/api/convert-to-iges', (req, res) => {
    // Set long timeout for large models
    res.setTimeout(300000); // 5 minute timeout

    try {
        const { vertices, triangles, physicalGroups } = req.body;

        if (!vertices || !triangles || !physicalGroups) {
            return res.status(400).json({ error: 'Missing required data' });
        }

        console.log(`Received model with ${vertices.length / 3} vertices, ${triangles.length / 3} triangles, and ${physicalGroups.length} groups`);

        // Create unique IDs for input and output files
        const sessionId = uuidv4();
        const inputFile = path.join(tempDir, `model_${sessionId}.json`);
        const outputFile = path.join(tempDir, `model_${sessionId}.igs`);

        // Save model data to JSON file
        fs.writeFileSync(inputFile, JSON.stringify({
            vertices,
            triangles,
            physicalGroups
        }));

        console.log('Model data saved to JSON file, executing Python script...');

        // Execute Python script to convert to IGES with increased timeout
        console.log(`Executing Python script: python3 tools/gmsh_export.py ${inputFile} ${outputFile}`);

        const childProcess = exec(`python3 tools/gmsh_export.py ${inputFile} ${outputFile}`, {
            timeout: 300000,
            maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large outputs
        }, (error, stdout, stderr) => {
            console.log(`Python script stdout: ${stdout}`);

            if (error) {
                console.error(`Error executing Python script: ${error.message}`);
                console.error(`stderr: ${stderr}`);
                // Clean up the input file even on error
                if (fs.existsSync(inputFile)) {
                    try { fs.unlinkSync(inputFile); } catch (e) { console.error(`Failed to delete input file: ${e}`); }
                }

                // Create a placeholder file if the output file doesn't exist
                if (!fs.existsSync(outputFile)) {
                    try {
                        fs.writeFileSync(outputFile, 'Error: Failed to generate IGES file');
                        console.log('Created fallback IGES file due to error');
                    } catch (e) {
                        console.error(`Failed to create fallback file: ${e}`);
                        return res.status(500).json({ error: 'Failed to convert model', details: stderr });
                    }
                }

                return res.status(500).json({ error: 'Failed to convert model', details: stderr });
            }

            console.log(`Python script completed: ${stdout}`);

            // Check if output file exists
            if (!fs.existsSync(outputFile)) {
                // Clean up the input file
                if (fs.existsSync(inputFile)) {
                    try { fs.unlinkSync(inputFile); } catch (e) { console.error(`Failed to delete input file: ${e}`); }
                }
                return res.status(500).json({ error: 'Failed to generate IGES file' });
            }

            // Get metadata file path
            const metadataFile = outputFile + '.meta.json';
            const finalOutputFile = path.join(tempDir, `model_final_${sessionId}.igs`);

            console.log('IGES file generated, now applying physical groups...');

            // Run the apply_groups.py script to add physical groups to the IGES file
            exec(`python3 tools/apply_groups.py ${outputFile} ${metadataFile} ${finalOutputFile}`, { timeout: 300000 }, (applyError, applyStdout, applyStderr) => {
                // Log output regardless of success or failure
                console.log(`Physical groups script output: ${applyStdout}`);
                if (applyStderr) {
                    console.error(`Physical groups script errors: ${applyStderr}`);
                }

                // Determine which file to send (the original or the one with groups)
                const fileToSend = fs.existsSync(finalOutputFile) ? finalOutputFile : outputFile;

                console.log(`Sending IGES file: ${fileToSend}`);

                // Send file to client
                res.download(fileToSend, 'model.igs', (err) => {
                    if (err) {
                        console.error(`Download error: ${err}`);
                    }

                    // Clean up temporary files
                    try {
                        if (fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
                        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
                        if (fs.existsSync(metadataFile)) fs.unlinkSync(metadataFile);
                        if (fs.existsSync(finalOutputFile)) fs.unlinkSync(finalOutputFile);
                        console.log('Temporary files cleaned up');
                    } catch (e) {
                        console.error(`Cleanup error: ${e}`);
                    }
                });
            });
        });
    } catch (err) {
        console.error(`Server error: ${err}`);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});
// API endpoint to merge STP files using Python script
// Endpoint to create a direct 3D viewer link for merged files
app.get('/merged-viewer', (req, res) => {
    const mergedFileName = req.query.file;
    const filePath = path.join(tempDir, mergedFileName);

    console.log(`Checking for merged file: ${filePath}`);

    if (!mergedFileName || !fs.existsSync(filePath)) {
        console.error(`Merged file not found: ${filePath}`);
        return res.status(404).send('Merged file not found');
    }

    // If a download parameter is present, send the file as a download
    if (req.query.download === 'true') {
        return res.download(filePath, mergedFileName, (err) => {
            if (err) {
                console.error(`Error downloading file: ${err}`);
            }
        });
    }

    // Create an absolute URL for the merged model
    const fileUrlPath = `/temp/${mergedFileName}`;
    const urlWithHash = `/website/index.html#model=${fileUrlPath}`;

    console.log(`Redirecting to viewer with model: ${urlWithHash}`);

    // Redirect to the main viewer with the model hash
    return res.redirect(urlWithHash);
});
// Direct endpoint to download a merged file
app.get('/temp/:filename', (req, res, next) => {
    const filename = req.params.filename;
    const filePath = path.join(tempDir, filename);

    console.log(`Requested temp file: ${filename}`);
    console.log(`Full path: ${filePath}`);

    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        return next(); // Let the static middleware handle it or return 404
    }

    // If download parameter is present, send as attachment
    if (req.query.download === 'true') {
        return res.download(filePath, filename, (err) => {
            if (err) {
                console.error(`Error downloading file: ${err}`);
                next(err);
            }
        });
    }

    // Otherwise, let the static middleware handle it
    next();
});
app.post('/api/merge-stp', upload.array('files', 2), (req, res) => {
    // Set timeout for large files
    res.setTimeout(300000); // 5 minute timeout

    try {
        if (!req.files || req.files.length !== 2) {
            return res.status(400).json({ error: 'Please upload exactly 2 STP/STEP files' });
        }
        // Log file info for debugging
        console.log('Files received:');
        console.log(JSON.stringify(req.files, null, 2));

        // Get file paths
        const file1Path = req.files[0].path;
        const file2Path = req.files[1].path;

        // Check if files exist
        if (!fs.existsSync(file1Path)) {
            console.error(`File 1 does not exist: ${file1Path}`);
            return res.status(500).json({ error: 'First file not found' });
        }

        if (!fs.existsSync(file2Path)) {
            console.error(`File 2 does not exist: ${file2Path}`);
            return res.status(500).json({ error: 'Second file not found' });
        }

        console.log('File paths:');
        console.log(`File 1 path: ${file1Path}`);
        console.log(`File 2 path: ${file2Path}`);

        // Determine output file extension based on input files
        const file1Ext = path.extname(file1Path).toLowerCase();
        const file2Ext = path.extname(file2Path).toLowerCase();

        // If either file is IGES, output as IGES
        let outputExt = '.stp';
        if (file1Ext === '.igs' || file1Ext === '.iges' || file2Ext === '.igs' || file2Ext === '.iges') {
            outputExt = '.igs';
        }

        // Generate output filename
        const outputId = uuidv4();
        const outputPath = path.join(tempDir, 'merged_' + outputId + outputExt);

        // Path to Python script (use local script in tools directory)
        const mergerScriptPath = path.join(__dirname, 'tools', 'stp_merger.py');

        // Check if the merger script exists
        if (!fs.existsSync(mergerScriptPath)) {
            console.error(`Python merger script not found at: ${mergerScriptPath}`);
            return res.status(500).json({ error: 'Python merger script not found' });
        }

        // Make sure the script is executable
        try {
            fs.chmodSync(mergerScriptPath, '755');
        } catch (e) {
            console.error(`Failed to make script executable: ${e}`);
            // Continue anyway, as this might not be necessary on all platforms
        }

        console.log('Merging files:');
        console.log(`- File 1: ${file1Path}`);
        console.log(`- File 2: ${file2Path}`);
        console.log(`- Output: ${outputPath}`);

        // Get the X offset value (default to 100 if not provided)
        let xOffset = 100;
        try {
            // Form data is not automatically parsed into req.body
            // It's available directly in the request object
            xOffset = Number(req.body?.xOffset) || Number(req.query?.xOffset) || 100;
        } catch (e) {
            console.error('Error parsing xOffset:', e);
        }
        console.log(`Using X offset: ${xOffset}`);

        // Define the helper function first
        const handleCommandResult = function(error, stdout, stderr, file1Path, file2Path, outputPath, res) {
            // Clean up input files regardless of success or failure
            try {
                fs.unlinkSync(file1Path);
                fs.unlinkSync(file2Path);
                console.log('Input files cleaned up');
            } catch (e) {
                console.error(`Failed to delete input files: ${e}`);
            }

            if (error) {
                console.error('Error executing Python script:', error.message);
                console.error('stderr:', stderr);
                console.error('Current directory:', __dirname);
                console.error('Full error object:', error);
                console.log('Attempting basic fallback merge...');

                try {
                    // Try a very basic concatenation
                    const file1Content = fs.readFileSync(file1Path, 'utf8');
                    const file2Content = fs.readFileSync(file2Path, 'utf8');

                    console.log(`File 1 size: ${file1Content.length} bytes`);
                    console.log(`File 2 size: ${file2Content.length} bytes`);

                    // Check if files are STEP or IGES
                    const isIges1 = file1Path.toLowerCase().endsWith('.igs') || file1Path.toLowerCase().endsWith('.iges');
                    const isIges2 = file2Path.toLowerCase().endsWith('.igs') || file2Path.toLowerCase().endsWith('.iges');

                    let mergedContent = '';
                    let success = false;

                    if (isIges1 || isIges2) {
                        // Handle IGES files
                        console.log('Merging IGES files...');

                        try {
                            // IGES format requires preserving entity structure for face selectability
                            // The issue is that references in parameter data also need to be updated

                            // Split the content into lines
                            const file1Lines = file1Content.split('\n');
                            const file2Lines = file2Content.split('\n');

                            // Separate lines by section
                            const startLines = file1Lines.filter(line =>
                                line.length >= 73 && line[72] === 'S');
                            const globalLines = file1Lines.filter(line =>
                                line.length >= 73 && line[72] === 'G');
                            const dir1Lines = file1Lines.filter(line =>
                                line.length >= 73 && line[72] === 'D');
                            const param1Lines = file1Lines.filter(line =>
                                line.length >= 73 && line[72] === 'P');

                            const dir2Lines = file2Lines.filter(line =>
                                line.length >= 73 && line[72] === 'D');
                            const param2Lines = file2Lines.filter(line =>
                                line.length >= 73 && line[72] === 'P');

                            // Build a map of all entity numbers to their new offsets
                            let maxEntityNum = 0;
                            const entityMap = {};

                            // Find max entity number in first file
                            for (const line of dir1Lines) {
                                if (line.length >= 8) {
                                    const entityNum = parseInt(line.substring(0, 8).trim());
                                    if (!isNaN(entityNum) && entityNum > maxEntityNum) {
                                        maxEntityNum = entityNum;
                                    }
                                }
                            }

                            console.log(`Max entity number in first file: ${maxEntityNum}`);

                            // Create the entity mapping for the second file
                            for (const line of dir2Lines) {
                                if (line.length >= 8) {
                                    const entityNum = parseInt(line.substring(0, 8).trim());
                                    if (!isNaN(entityNum)) {
                                        entityMap[entityNum] = entityNum + maxEntityNum;
                                    }
                                }
                            }

                            // Process directory entries for second file
                            const processedDir2Lines = [];
                            for (const line of dir2Lines) {
                                if (line.length >= 8) {
                                    const entityNum = parseInt(line.substring(0, 8).trim());
                                    if (!isNaN(entityNum)) {
                                        // Create new line with offset entity number
                                        const newNum = entityMap[entityNum];
                                        const paddedNum = String(newNum).padStart(8);
                                        processedDir2Lines.push(paddedNum + line.substring(8));
                                    } else {
                                        processedDir2Lines.push(line);
                                    }
                                } else {
                                    processedDir2Lines.push(line);
                                }
                            }

                            // Helper function to update entity references in parameter data
                            // This is critical for face selectability
                            const updateReferences = (paramText) => {
                                // We need a more robust replacement method
                                // that won't match partial numbers or create incorrect replacements

                                let result = paramText;

                                // Need to do replacements from longest entity IDs to shortest
                                // to avoid partial replacements like replacing "12" inside "123"
                                const entityNums = Object.keys(entityMap)
                                    .map(k => parseInt(k))
                                    .sort((a, b) => String(b).length - String(a).length || b - a);

                                // Helper for safely replacing entity references
                                const safeReplace = (text, oldPattern, newPattern) => {
                                    // Use regex with word boundaries to avoid replacing parts of other numbers
                                    const regex = new RegExp(oldPattern, 'g');
                                    return text.replace(regex, newPattern);
                                };

                                // Process each entity reference
                                for (const oldNum of entityNums) {
                                    const newNum = entityMap[oldNum];

                                    // Handle comma-delimited references (most common pattern)
                                    result = safeReplace(result, `(,)${oldNum}(,)`, `$1${newNum}$2`);

                                    // Handle start of line/parameter references
                                    if (result.startsWith(`${oldNum},`)) {
                                        result = `${newNum},` + result.substring(String(oldNum).length + 1);
                                    }

                                    // Handle end of line/parameter references
                                    result = safeReplace(result, `(,)${oldNum}$`, `$1${newNum}`);

                                    // Handle semicolon-terminated references
                                    result = safeReplace(result, `(,)${oldNum}(;)`, `$1${newNum}$2`);

                                    // If the result consists only of this entity number
                                    if (result === String(oldNum)) {
                                        result = String(newNum);
                                    }
                                }

                                return result;
                            };

                            // Process parameter entries for second file
                            const processedParam2Lines = [];
                            for (const line of param2Lines) {
                                try {
                                    if (line.length >= 8) {
                                        // Process entity number at the start
                                        const entityNum = parseInt(line.substring(0, 8).trim());
                                        let newLine = line;

                                        if (!isNaN(entityNum) && entityMap[entityNum]) {
                                            // Get the new entity number
                                            const newNum = entityMap[entityNum];

                                            // Extract parameter content and record section
                                            let paramContent = line.substring(8);
                                            let recordNum = "";

                                            if (paramContent.length >= 8 &&
                                                paramContent.substring(paramContent.length-8).trim().startsWith('P')) {
                                                recordNum = paramContent.substring(paramContent.length-8);
                                                paramContent = paramContent.substring(0, paramContent.length-8);
                                            }

                                            // Update all entity references in parameter data
                                            const updatedParam = updateReferences(paramContent);

                                            // Reconstruct the line
                                            newLine = `${String(newNum).padStart(8)}${updatedParam}${recordNum}`;
                                        }

                                        processedParam2Lines.push(newLine);
                                    } else {
                                        processedParam2Lines.push(line);
                                    }
                                } catch (err) {
                                    console.error("Error processing param line:", err);
                                    processedParam2Lines.push(line);
                                }
                            }

                            // Add translation entity for second model - creates a transformation matrix
                            // IGES type 124 is a transformation matrix
                            const transEntityNum = maxEntityNum + 1;
                            const transDirEntry = `${String(transEntityNum).padStart(8)}     124       0       0       0       0       0       000000001D      1`;
                            const transParamEntry = `${String(transEntityNum).padStart(8)},124,${offset[0]},${offset[1]},${offset[2]},1.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,1.0;   1P      1`;

                            // Add marker entity to separate models (helps debugging)
                            const markerEntityNum = maxEntityNum + 2;
                            const markerDirEntry = `${String(markerEntityNum).padStart(8)}     406       0       0       0       0       0       000000001D      2`;
                            const markerParamEntry = `${String(markerEntityNum).padStart(8)},406,6HMODEL2;                                              1P      2`;

                            // Combine all directory entries
                            const allDirEntries = [
                                ...dir1Lines,
                                transDirEntry,
                                markerDirEntry,
                                ...processedDir2Lines
                            ];

                            // Combine all parameter entries
                            const allParamEntries = [
                                ...param1Lines,
                                transParamEntry,
                                markerParamEntry,
                                ...processedParam2Lines
                            ];

                            // Create terminate section
                            const terminateLine = `S${String(startLines.length).padStart(7)}G${String(globalLines.length).padStart(7)}D${String(allDirEntries.length).padStart(7)}P${String(allParamEntries.length).padStart(7)}T0000001${' '.repeat(40)}T0000001`;

                            // Combine all sections into final IGES file
                            mergedContent = [
                                ...startLines,
                                ...globalLines,
                                ...allDirEntries,
                                ...allParamEntries,
                                terminateLine
                            ].join('\n');

                            success = true;
                        } catch (e) {
                            console.error('Error merging IGES files:', e);
                            return res.status(500).json({ error: 'Failed to merge IGES files', details: e.message });
                        }

                    } else {
                        // Handle STEP files
                        console.log('Merging STEP files...');

                        try {
                            // Extract DATA sections from the two files
                            const dataPattern = /DATA;([\s\S]*?)ENDSEC;/;
                            const file1Match = file1Content.match(dataPattern);
                            const file2Match = file2Content.match(dataPattern);

                            if (file1Match && file2Match) {
                                const file1Data = file1Match[1]; // Content between DATA; and ENDSEC;
                                const file2Data = file2Match[1]; // Content between DATA; and ENDSEC;

                                console.log(`Extracted data 1 size: ${file1Data.length} bytes`);
                                console.log(`Extracted data 2 size: ${file2Data.length} bytes`);

                                // Create a merged STEP file that preserves individual meshes
                                // We need to ensure meshes remain separate and selectable

                                // Count entities in first file to offset entity IDs in second file
                                const entityCountRegex = /#(\d+)=/g;
                                let maxEntityId = 0;

                                let match;
                                while ((match = entityCountRegex.exec(file1Data)) !== null) {
                                    const entityId = parseInt(match[1]);
                                    if (entityId > maxEntityId) {
                                        maxEntityId = entityId;
                                    }
                                }

                                console.log(`Highest entity ID in first file: ${maxEntityId}`);

                                // Replace entity references in second file with offset
                                let processedFile2Data = file2Data;
                                const refRegex = /#(\d+)/g;

                                processedFile2Data = processedFile2Data.replace(refRegex, (match, entityId) => {
                                    const newId = parseInt(entityId) + maxEntityId;
                                    return `#${newId}`;
                                });

                                // Add a marker at the end of file1Data to help identify meshes from different files
                                file1Data += `\n/* MODEL_BOUNDARY_MARKER_${Date.now()} */\n`;

                                // Find all ADVANCED_BREP_SHAPE_REPRESENTATION entity IDs in each file
                                // These represent the top-level shapes in the STEP file
                                const advBrepPattern = /#(\d+)=ADVANCED_BREP_SHAPE_REPRESENTATION/g;

                                // Find all shapes in first file
                                const file1Shapes = [];
                                let advMatch;
                                while ((advMatch = advBrepPattern.exec(file1Data)) !== null) {
                                    file1Shapes.push(parseInt(advMatch[1]));
                                }

                                // Reset regex lastIndex
                                advBrepPattern.lastIndex = 0;

                                // Find all shapes in second file
                                const file2Shapes = [];
                                while ((advMatch = advBrepPattern.exec(processedFile2Data)) !== null) {
                                    file2Shapes.push(parseInt(advMatch[1]));
                                }

                                console.log(`Found ${file1Shapes.length} top-level shapes in first file`);
                                console.log(`Found ${file2Shapes.length} top-level shapes in second file`);

                                // Extract manifold solids (represent individual selectable objects)
                                const manifestSolidPattern = /#(\d+)=MANIFOLD_SOLID_BREP\('([^']+)'/g;

                                // Find all manifold solids in first file
                                const file1Solids = [];
                                let solidMatch;
                                while ((solidMatch = manifestSolidPattern.exec(file1Data)) !== null) {
                                    file1Solids.push({
                                        id: parseInt(solidMatch[1]),
                                        name: solidMatch[2]
                                    });
                                }

                                // Reset regex lastIndex
                                manifestSolidPattern.lastIndex = 0;

                                // Find all manifold solids in second file
                                const file2Solids = [];
                                while ((solidMatch = manifestSolidPattern.exec(processedFile2Data)) !== null) {
                                    file2Solids.push({
                                        id: parseInt(solidMatch[1]),
                                        name: solidMatch[2]
                                    });
                                }

                                console.log(`Found ${file1Solids.length} manifold solids in first file`);
                                console.log(`Found ${file2Solids.length} manifold solids in second file`);

                                // Build physical group data with detailed entity associations
                                // We need to generate:
                                // 1. Common style definitions
                                // 2. Individual physical groups for each volume/solid in each model
                                // 3. Hierarchical structure preserving model 1 vs model 2 distinction

                                let physicalGroupsData = `
/* Physical Groups for merged model - Base Styles */
#${maxEntityId + 1000}=PRESENTATION_STYLE_ASSIGNMENT((#${maxEntityId + 1001}));
#${maxEntityId + 1001}=SURFACE_STYLE_USAGE(.BOTH.,#${maxEntityId + 1002});
#${maxEntityId + 1002}=SURFACE_STYLE_FILL_AREA(#${maxEntityId + 1003});
#${maxEntityId + 1003}=FILL_AREA_STYLE('',(#${maxEntityId + 1004}));
#${maxEntityId + 1004}=FILL_AREA_STYLE_COLOUR('',$);
/* Common application context */
#${maxEntityId + 1014}=APPLICATION_CONTEXT('automotive design');
/* Model hierarchy nodes */
#${maxEntityId + 2000}=PRODUCT_DEFINITION('Model1','',#${maxEntityId + 2001},$);
#${maxEntityId + 2001}=PRODUCT_DEFINITION_CONTEXT('',#${maxEntityId + 1014},'design');
#${maxEntityId + 2002}=PRODUCT_DEFINITION('Model2','',#${maxEntityId + 2001},$);
`;
                                // Add physical groups for each solid/volume in Model 1
                                file1Solids.forEach((solid, index) => {
                                    const baseId = maxEntityId + 3000 + (index * 10);
                                    physicalGroupsData += `
/* Model 1 - ${solid.name} Physical Group */
#${baseId}=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#${baseId + 1}),#${baseId + 2});
#${baseId + 1}=STYLED_ITEM('',(#${maxEntityId + 1000}),#${solid.id});
#${baseId + 2}=MECHANICAL_CONTEXT('',#${maxEntityId + 1014},'Model1_${solid.name.replace(/\s+/g, '_')}');
#${baseId + 3}=SHAPE_DEFINITION_REPRESENTATION(#${baseId + 4},#${baseId});
#${baseId + 4}=PRODUCT_DEFINITION_SHAPE('${solid.name}','',#${maxEntityId + 2000});
`;
                                });
                                // Add physical groups for each solid/volume in Model 2
                                file2Solids.forEach((solid, index) => {
                                    const baseId = maxEntityId + 5000 + (index * 10);
                                    physicalGroupsData += `
/* Model 2 - ${solid.name} Physical Group */
#${baseId}=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#${baseId + 1}),#${baseId + 2});
#${baseId + 1}=STYLED_ITEM('',(#${maxEntityId + 1000}),#${solid.id});
#${baseId + 2}=MECHANICAL_CONTEXT('',#${maxEntityId + 1014},'Model2_${solid.name.replace(/\s+/g, '_')}');
#${baseId + 3}=SHAPE_DEFINITION_REPRESENTATION(#${baseId + 4},#${baseId});
#${baseId + 4}=PRODUCT_DEFINITION_SHAPE('${solid.name}','',#${maxEntityId + 2002});
`;
                                });
                                // Add overall model physical groups
                                physicalGroupsData += `
/* Overall Model 1 Physical Group */
#${maxEntityId + 8000}=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#${maxEntityId + 8001}),#${maxEntityId + 8002});
#${maxEntityId + 8001}=STYLED_ITEM('',(#${maxEntityId + 1000}),#${file1Shapes[0] || 0});
#${maxEntityId + 8002}=MECHANICAL_CONTEXT('',#${maxEntityId + 1014},'Model1');
/* Overall Model 2 Physical Group */
#${maxEntityId + 9000}=MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#${maxEntityId + 9001}),#${maxEntityId + 9002});
#${maxEntityId + 9001}=STYLED_ITEM('',(#${maxEntityId + 1000}),#${file2Shapes[0] || 0});
#${maxEntityId + 9002}=MECHANICAL_CONTEXT('',#${maxEntityId + 1014},'Model2');
`;

                                // Create a more comprehensive merged STEP file
                                mergedContent =
                                `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Merged Model with Physical Groups'),'2;1');
FILE_NAME('merged_model.stp','${new Date().toISOString()}',('Online3DViewer'),(''),'',' ','Online3DViewer');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 3 1 1 }'));
ENDSEC;
DATA;${file1Data}${processedFile2Data}${physicalGroupsData}
ENDSEC;
END-ISO-10303-21;`;

                                success = true;
                            } else {
                                console.error('Could not extract DATA sections from STEP files');
                                console.log('File 1 match:', !!file1Match);
                                console.log('File 2 match:', !!file2Match);
                                return res.status(500).json({ error: 'Failed to merge STEP files', details: 'Could not extract data sections' });
                            }
                        } catch (e) {
                            console.error('Error merging STEP files:', e);
                            return res.status(500).json({ error: 'Failed to merge STEP files', details: e.message });
                        }
                    }

                    if (success) {
                        console.log(`Merged content size: ${mergedContent.length} bytes`);

                        fs.writeFileSync(outputPath, mergedContent, 'utf8');
                        console.log(`Wrote merged file to: ${outputPath}`);

                        // Extract just the filename part
                        const fileName = path.basename(outputPath);
                        console.log(`Serving file: ${fileName}`);

                        // Return a response with the URL to the direct viewer page
                        return res.json({
                            success: true,
                            viewerUrl: `/website/direct-viewer.html?file=${fileName}`,
                            fileName: fileName
                        });
                    }
                } catch (fallbackError) {
                    console.error('Fallback merge failed:', fallbackError);
                }

                return res.status(500).json({ error: 'Failed to merge files', details: stderr || error.message });
            }

            console.log('Python script output:', stdout);

            // Check if output file exists
            if (!fs.existsSync(outputPath)) {
                return res.status(500).json({ error: 'Merged file not found' });
            }

            // Instead of sending the file for download, keep it on the server
            // and provide a URL to the merged-viewer page

            // Extract just the filename part
            const fileName = path.basename(outputPath);

            console.log(`Merged file created at: ${outputPath}`);
            console.log(`Serving viewer with file: ${fileName}`);

            // Return a response with the URL to the direct viewer page
            res.json({
                success: true,
                viewerUrl: `/website/direct-viewer.html?file=${fileName}`,
                fileName: fileName
            });
        };

        // Execute the Python script to merge files with the offset value
        // We'll try to use python3 first, and if that fails, fall back to python
        const command = `python3 "${mergerScriptPath}" "${file1Path}" "${file2Path}" "${outputPath}" ${xOffset}`;

        console.log('Executing:', command);

        exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
            // If python3 failed, try with python
            if (error && error.code === 127) { // 127 is "command not found"
                console.log('python3 not found, trying with python instead');
                const altCommand = `python "${mergerScriptPath}" "${file1Path}" "${file2Path}" "${outputPath}" ${xOffset}`;

                return exec(altCommand, { timeout: 300000 }, (altError, altStdout, altStderr) => {
                    // Handle the result of the alternative command
                    handleCommandResult(altError, altStdout, altStderr, file1Path, file2Path, outputPath, res);
                });
            }

            // Otherwise, handle the result as normal
            handleCommandResult(error, stdout, stderr, file1Path, file2Path, outputPath, res);
        });
    } catch (err) {
        console.error(`Server error: ${err}`);
        res.status(500).json({ error: 'Server error', details: err.message });
    }
});
// API endpoint for uploading files with model ID organization
app.post('/api/upload', upload.any(), (req, res) => {
    console.log('Received file upload request');

    try {
        if (!req.files || req.files.length === 0) {
            console.error('No files received');
            return res.status(400).json({ error: 'No files received' });
        }

        // Get model ID from request body, generate one if not provided
        const modelId = req.body.modelId ||
                      'model_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);

        // Define an absolute path for your models directory
        // Change this to your desired location
        const modelsDir = '/Users/pranav/Desktop/project2/v4/models';  // On Linux/Mac
        // const modelsDir = 'D:\\path\\to\\external\\models';  // On Windows

        // Create models directory if it doesn't exist
        if (!fs.existsSync(modelsDir)) {
            fs.mkdirSync(modelsDir, { recursive: true });
        }

        // Create model directory if it doesn't exist
        const modelDir = path.join(modelsDir, modelId);
        if (!fs.existsSync(modelDir)) {
            fs.mkdirSync(modelDir, { recursive: true });
        }

        // Move files to model directory and track their info
        const fileList = req.files.map(file => {
            // Get original name or use the filename from multer
            const originalName = req.body.groupName ?
                                `${req.body.groupName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.glb` :
                                file.originalname;

            // Create new path in the model directory
            const newPath = path.join(modelDir, originalName);

            // Move the file from temp to model directory
            fs.renameSync(file.path, newPath);

            console.log(`Moved file from ${file.path} to ${newPath}`);

            return {
                originalname: originalName,
                filename: path.basename(newPath),
                path: newPath,
                // We need a URL that the server can use to serve these files
                url: `/external-models/${modelId}/${originalName}`
            };
        });

        // Return success with file information
        res.status(200).json({
            success: true,
            message: `Uploaded ${req.files.length} files to model directory`,
            modelId: modelId,
            files: fileList
        });
    } catch (error) {
        console.error('Error handling file upload:', error);
        res.status(500).json({ error: 'File upload failed', details: error.message });
    }
});

// Serve files from the external models directory
app.use('/external-models', express.static('/Users/pranav/Desktop/project2/v4/models'));
// For Windows: app.use('/external-models', express.static('D:\\path\\to\\external\\models'));

// Start server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening at http://0.0.0.0:${port}`);
  });
