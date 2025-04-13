const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process'); // Added for executing shell scripts
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));

// Serve simulation results from a specific directory
app.use('/simulation-results', express.static('/mnt/Ayrton/simulation/results'));

app.post('/save-mold-info', (req, res) => {
    const { info } = req.body;
    if (!info) {
        return res.status(400).json({ error: 'No information provided' });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `mold-submission-${timestamp}.txt`;
    const filePath = path.join(__dirname, 'submissions', filename);
    
    fs.mkdirSync(path.join(__dirname, 'submissions'), { recursive: true });
    fs.writeFile(filePath, info, (err) => {
        if (err) {
            console.error('Error writing file:', err);
            return res.status(500).json({ error: 'Failed to save information' });
        }
        console.log(`Saved mold submission to ${filename}`);
        res.json({ success: true, message: 'Information saved successfully' });
    });
});

app.post('/save-melt-info', (req, res) => {
    const { info } = req.body;
    if (!info) {
        return res.status(400).json({ error: 'No information provided' });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `melt-submission-${timestamp}.txt`;
    const filePath = path.join(__dirname, 'submissions', filename);
    
    fs.mkdirSync(path.join(__dirname, 'submissions'), { recursive: true });
    fs.writeFile(filePath, info, (err) => {
        if (err) {
            console.error('Error writing file:', err);
            return res.status(500).json({ error: 'Failed to save information' });
        }
        console.log(`Saved melt submission to ${filename}`);
        res.json({ success: true, message: 'Information saved successfully' });
    });
});

// New endpoint to run the simulation script
app.post('/run-simulation', (req, res) => {
    console.log('Starting simulation script at /mnt/Ayrton/simulation/runner.sh');
    
    exec('/mnt/Ayrton/simulation/runner.sh', (error, stdout, stderr) => {
        if (error) {
            console.error(`Error executing simulation: ${error}`);
            return res.status(500).json({ 
                success: false, 
                message: 'Simulation failed to run', 
                error: error.message 
            });
        }
        
        console.log(`Simulation output: ${stdout}`);
        if (stderr) {
            console.error(`Simulation stderr: ${stderr}`);
        }
        
        res.json({ 
            success: true, 
            message: 'Simulation completed successfully',
            output: stdout
        });
    });
});

// Optional: Add an endpoint to stop the simulation if needed
// app.post('/stop-simulation', (req, res) => {
//     console.log('Attempting to stop simulation...');
//     
//     // You would need to implement a way to find and kill the running process
//     // This is a simplified example using pkill (works on Linux/Unix systems)
//     exec('pkill -f "runner.sh"', (error, stdout, stderr) => {
//         if (error && error.code !== 1) { // pkill returns 1 if no processes were killed
//             console.error(`Error stopping simulation: ${error}`);
//             return res.status(500).json({ 
//                 success: false, 
//                 message: 'Failed to stop simulation', 
//                 error: error.message 
//             });
//         }
//         
//         console.log('Simulation stopped');
//         res.json({ 
//             success: true, 
//             message: 'Simulation stopped successfully'
//         });
//     });
// });

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});