// Service worker to handle serving merged file content
let mergedFileContent = null;
let mergedFileName = null;

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'STORE_MERGED_FILE') {
    mergedFileContent = event.data.content;
    mergedFileName = event.data.filename;
    console.log('Service worker received merged file data');
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Check if this is a request for our merged file
  if (url.pathname.endsWith('/merged-model.stp') && mergedFileContent) {
    console.log('Service worker intercepting request for merged file');
    
    // Create a response with the merged file content
    const response = new Response(mergedFileContent, {
      headers: {
        'Content-Type': 'application/step',
        'Content-Disposition': `attachment; filename="${mergedFileName || 'merged-model.stp'}"`,
      }
    });
    
    event.respondWith(response);
  }
});

// Log when the service worker is installed
self.addEventListener('install', (event) => {
  console.log('Service worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service worker activated');
  event.waitUntil(self.clients.claim());
});