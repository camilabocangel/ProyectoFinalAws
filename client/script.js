// Variables globales
let pdfs = [];

// DOM Elements
const pdfUploadInput = document.getElementById('pdf-upload');
const uploadBtn = document.getElementById('upload-btn');
const uploadStatus = document.getElementById('upload-status');
const pdfListElement = document.getElementById('pdf-list');
const pdfSelector = document.getElementById('pdf-selector');
const questionInput = document.getElementById('question-input');
const askBtn = document.getElementById('ask-btn');
const answerSection = document.getElementById('answer-section');

// API Base URL - Ajustar según tu despliegue
const API_BASE_URL = 'http://tu-endpoint-api.com';

// Event Listeners
document.addEventListener('DOMContentLoaded', fetchPdfs);
uploadBtn.addEventListener('click', handleUpload);
askBtn.addEventListener('click', handleQuestion);

// Función para obtener la lista de PDFs
async function fetchPdfs() {
    try {
        const response = await fetch(`${API_BASE_URL}/list-pdfs`);
        if (!response.ok) throw new Error('Error al obtener PDFs');
        
        const data = await response.json();
        pdfs = data.files || [];
        
        renderPdfList();
        renderPdfSelector();
    } catch (error) {
        console.error('Error:', error);
        alert('Error al cargar la lista de PDFs');
    }
}

// Función para renderizar la lista de PDFs
function renderPdfList() {
    pdfListElement.innerHTML = '';
    
    if (pdfs.length === 0) {
        pdfListElement.innerHTML = '<p>No hay PDFs disponibles</p>';
        return;
    }
    
    pdfs.forEach(pdf => {
        const pdfItem = document.createElement('div');
        pdfItem.className = 'pdf-item';
        pdfItem.innerHTML = `
            <strong>${pdf.key.split('/').pop()}</strong>
            <p>Tamaño: ${formatFileSize(pdf.size)}</p>
            <p>Subido: ${new Date(pdf.lastModified).toLocaleDateString()}</p>
        `;
        pdfListElement.appendChild(pdfItem);
    });
}

// Función para renderizar el selector de PDFs
function renderPdfSelector() {
    pdfSelector.innerHTML = '<option value="">Selecciona un PDF</option>';
    
    pdfs.forEach(pdf => {
        const option = document.createElement('option');
        option.value = pdf.key;
        option.textContent = pdf.key.split('/').pop();
        pdfSelector.appendChild(option);
    });
}

// Función para manejar la subida de PDFs
async function handleUpload() {
    const file = pdfUploadInput.files[0];
    if (!file) {
        uploadStatus.textContent = 'Por favor selecciona un archivo PDF';
        uploadStatus.className = 'error';
        return;
    }
    
    try {
        // 1. Obtener URL firmada para subir
        const signedUrlResponse = await fetch(`${API_BASE_URL}/get-signed-url-pdf`);
        if (!signedUrlResponse.ok) throw new Error('Error al obtener URL de subida');
        
        const { url, key } = await signedUrlResponse.json();
        
        // 2. Subir el archivo directamente a S3
        const uploadResponse = await fetch(url, {
            method: 'PUT',
            body: file,
            headers: {
                'Content-Type': 'application/pdf'
            }
        });
        
        if (!uploadResponse.ok) throw new Error('Error al subir el archivo');
        
        uploadStatus.textContent = 'PDF subido exitosamente! Procesando...';
        uploadStatus.className = 'success';
        
        // Esperar un poco y actualizar la lista
        setTimeout(fetchPdfs, 3000);
    } catch (error) {
        console.error('Error:', error);
        uploadStatus.textContent = `Error: ${error.message}`;
        uploadStatus.className = 'error';
    }
}

// Función para manejar preguntas
async function handleQuestion() {
    const selectedPdf = pdfSelector.value;
    const question = questionInput.value.trim();
    
    if (!selectedPdf || !question) {
        answerSection.innerHTML = '<p>Por favor selecciona un PDF y escribe una pregunta</p>';
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/query-pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                documentKey: selectedPdf,
                question: question
            })
        });
        
        if (!response.ok) throw new Error('Error al consultar el PDF');
        
        const data = await response.json();
        answerSection.innerHTML = `
            <h3>Respuesta:</h3>
            <p>${data.answer}</p>
        `;
    } catch (error) {
        console.error('Error:', error);
        answerSection.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    }
}

// Función auxiliar para formatear tamaño de archivo
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]);
}