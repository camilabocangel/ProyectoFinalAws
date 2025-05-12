const { S3Client, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const pdf = require('pdf-parse');
const s3 = new S3Client({ region: process.env.AWS_REGION });
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION });
const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

const chunkText = (text, chunkSize = 1000) => {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.substring(i, i + chunkSize));
    }
    return chunks;
};

const getEmbedding = async (text) => {
    const response = await bedrock.send(new InvokeModelCommand({
        modelId: process.env.EMBEDDING_MODEL,
        body: JSON.stringify({ inputText: text }),
        contentType: "application/json"
    }));
    return JSON.parse(Buffer.from(response.body).toString()).embedding;
};
const cosineSimilarity = (a, b) => {
    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
};

module.exports.getUploadUrlPdf = async (event) => {
    const {filename, filetype} = event.queryStringParameters || {};
    if (!filename || !filetype) {
        return {
            statusCode:400,
            headers: {'Access-Control-Allow-Origin': '*'},
            body: JSON.stringify({messsage: 'Parametros faltantes'})

        };
    }
    try {
        const key = `uploads/${Date.now()}-${filename}`;
        const command = new putObjectCommand({
            Bucket: process.env.BUCKET_NAME,
            Key: key,
            ContentType: filetype
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ url, key })
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message })
        };
    }
};

module.exports.procesarPdf = async (event) => {
    try {
        console.log('Iniciando procesamiento de PDF...');
        for (const record of event.Records) {
            const { key } = record.s3.object;
            console.log(`Procesando archivo ${key}`);
            
            const { Body } = await s3.send(new GetObjectCommand({
                Bucket: process.env.BUCKET_NAME,
                Key: key
            }));
            
            const data = await Body.transformToByteArray();
            const pdfBuffer = Buffer.from(data);
            
            const { text } = await pdf(pdfBuffer);
            console.log(`PDF parseado exitosamente. Longitud del texto: ${text.length} caracteres`);
            
            const chunks = chunkText(text);
            console.log(`Generando embeddings para ${chunks.length} fragmentos...`);
            
            for (const [index, chunk] of chunks.entries()) {
                const embedding = await getEmbedding(chunk);
                await dynamodb.send(new PutCommand({
                    TableName: process.env.TABLE_NAME,
                    Item: {
                        DocumentId: key,
                        FragmentId: index,
                        Text: chunk,
                        Embedding: embedding,
                        CreatedAt: new Date().toISOString()
                    }
                }));
            }
            console.log(`Procesamiento completado para: ${key}`);
        }
    } catch (error) {
        console.error('Error procesando PDF:', {
            message: error.message,
            stack: error.stack,
            rawError: error
        });
        throw error;
    }
};

module.exports.queryPdf = async (event) => {
    try {
        const { documentKey, question } = JSON.parse(event.body);
        
        const questionEmbedding = await getEmbedding(question);
        
        const { Items } = await dynamodb.send(new QueryCommand({
            TableName: process.env.TABLE_NAME,
            KeyConditionExpression: 'DocumentId = :docId',
            ExpressionAttributeValues: { ':docId': documentKey }
        }));
        
        let bestMatch = { similarity: -Infinity };
        for (const item of Items) {
            const similarity = cosineSimilarity(questionEmbedding, item.Embedding);
            if (similarity > bestMatch.similarity) bestMatch = { ...item, similarity };
        }
        
        const answer = await bedrock.send(new InvokeModelCommand({
            modelId: process.env.CHAT_MODEL,
            body: JSON.stringify({
                inputText: `Contexto: ${bestMatch.Text}\n\nPregunta: ${question}\nRespuesta:`,
                textGenerationConfig: {
                    maxTokenCount: 2048,
                    temperature: 0.5
                }
            }),
            contentType: "application/json"
        }));
        
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                answer: JSON.parse(Buffer.from(answer.body).toString()).results[0].outputText
            })
        };
    } catch (error) {
        console.error("Error en queryPdf:", error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message })
        };
    }
};

module.exports.listarPdfs = async () => {
    try {
        const data = await s3.send(new ListObjectsV2Command({
            Bucket: process.env.BUCKET_NAME,
            Prefix: 'uploads/'
        }));
        
        const files = (data.Contents || []).map(f => ({
            key: f.Key,
            size: f.Size,
            lastModified: f.LastModified
        }));
        
        return {
            statusCode: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ files })
        };
    } catch (error) {
        console.error("Error listando PDFs:", error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: error.message })
        };
    }
};