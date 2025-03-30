const express = require("express");   // Importa o módulo express para criação da API.
const mega = require("megajs");   // Importa o módulo megajs para interagir com o Mega.nz.
const fs = require("fs");   // Importa o módulo fs (sistema de arquivos) para manipulação de arquivos.
const multer = require("multer");   // Importa o módulo multer para lidar com uploads de arquivos.
const path = require("path");   // Importa o módulo path para manipulação de caminhos de arquivos.
const { promisify } = require("util");   // Importa promisify para converter funções baseadas em callback em promessas.
const sharp = require("sharp");   // Importa sharp para manipulação e conversão de imagens.
const ffmpeg = require("fluent-ffmpeg");   // Importa ffmpeg para manipulação e conversão de vídeos e áudios.
const libre = require("libreoffice-convert");   // Importa o módulo para converter documentos usando o LibreOffice.

const app = express();   // Cria uma instância do servidor Express.
const port = 3000;   // Define a porta que o servidor irá escutar.
app.use(express.json());   // Configura o Express para entender requisições no formato JSON.

const upload = multer({ dest: "uploads/" });   // Configura o multer para armazenar arquivos temporários na pasta "uploads".
const unlinkAsync = promisify(fs.unlink);   // Converte a função fs.unlink (remover arquivo) para usar promessas.
const downloadDir = path.join(__dirname, "downloads");   // Define o diretório de downloads.

if (!fs.existsSync(downloadDir)) {   // Verifica se o diretório de downloads existe.
    fs.mkdirSync(downloadDir, { recursive: true });   // Se não existir, cria o diretório de downloads.
}

const mediaDirectories = {   // Define os diretórios para armazenar os tipos de mídia.
    imagens: path.join(__dirname, "uploads/imagens"),   // Diretório para imagens.
    videos: path.join(__dirname, "uploads/videos"),   // Diretório para vídeos.
    audios: path.join(__dirname, "uploads/audios"),   // Diretório para áudios.
    documentos: path.join(__dirname, "uploads/documentos"),   // Diretório para documentos.
    originais: path.join(__dirname, "uploads/originais"),   // Diretório para arquivos originais.
};

// Garante que os diretórios para cada tipo de mídia e para os originais existam.
for (const dir in mediaDirectories) {   // Loop através dos diretórios.
    if (!fs.existsSync(mediaDirectories[dir])) {   // Verifica se o diretório não existe.
        fs.mkdirSync(mediaDirectories[dir], { recursive: true });   // Cria o diretório se não existir.
    }
}

// Função para garantir que a pasta no Mega.nz exista ou seja criada.
const ensureMegaFolderExists = (storage, folderPath) => {
    return new Promise((resolve, reject) => {
        // Tenta acessar o diretório no Mega.nz
        storage.root.get(folderPath, (err, folder) => {
            if (err && err.message === "not found") {
                // Se o diretório não for encontrado, cria-o
                storage.root.createFolder(folderPath, (err, newFolder) => {
                    if (err) return reject(err);   // Se houver erro ao criar a pasta, rejeita a promessa.
                    resolve(newFolder);   // Se a pasta for criada com sucesso, resolve a promessa.
                });
            } else if (err) {
                return reject(err);   // Se ocorrer outro erro, rejeita a promessa.
            } else {
                resolve(folder);   // Se a pasta já existir, resolve a promessa com a pasta encontrada.
            }
        });
    });
};

// Função para converter imagens para o formato WebP.
const convertImage = (filePath, outputPath) => sharp(filePath).webp({ quality: 80, effort: 6 }).toFile(outputPath);

// Função para converter vídeos para o formato WebM.
const convertVideo = (filePath, outputPath) => {  
    return new Promise((resolve, reject) => {   // Retorna uma promessa.
        ffmpeg(filePath)   // Usa o ffmpeg para processar o vídeo.
            .output(outputPath)   // Define o caminho de saída do vídeo convertido.
            .videoCodec("libvpx")   // Define o codec de vídeo.
            .audioCodec("libvorbis")   // Define o codec de áudio.
            .videoBitrate("500k")   // Define o bitrate do vídeo.
            .audioBitrate("128k")   // Define o bitrate do áudio.
            .on("end", resolve)   // Resolve a promessa quando o processo termina.
            .on("error", reject)   // Rejeita a promessa em caso de erro.
            .run();   // Executa o processo ffmpeg.
    });
};

// Função para comprimir áudio.
const compressAudio = (filePath, outputPath) => {  
    return new Promise((resolve, reject) => {   // Retorna uma promessa.
        ffmpeg(filePath)   // Usa o ffmpeg para processar o áudio.
            .output(outputPath)   // Define o caminho de saída do áudio comprimido.
            .audioCodec("libmp3lame")   // Define o codec de áudio.
            .audioBitrate("128k")   // Define o bitrate do áudio.
            .on("end", resolve)   // Resolve a promessa quando o processo termina.
            .on("error", reject)   // Rejeita a promessa em caso de erro.
            .run();   // Executa o processo ffmpeg.
    });
};

// Função para converter documentos para PDF.
const convertToPDF = (filePath) => {  
    return new Promise((resolve, reject) => {   // Retorna uma promessa.
        libre.convert(filePath, '.pdf', undefined, (err, done) => {   // Usa o LibreOffice para converter o documento para PDF.
            if (err) {   // Se houver erro na conversão.
                return reject(err);   // Rejeita a promessa.
            }
            const pdfPath = filePath.replace(path.extname(filePath), ".pdf");   // Substitui a extensão do arquivo para ".pdf".
            fs.writeFileSync(pdfPath, done);   // Escreve o conteúdo PDF no arquivo.
            resolve(pdfPath);   // Resolve a promessa com o caminho do arquivo PDF.
        });
    });
};

app.post("/mega", upload.single("file"), async (req, res) => {   // Rota POST para upload ou download de arquivos.
    const { email, password, mode, filePath } = req.body;   // Desestruturação para pegar o email, senha, modo e caminho do arquivo.

    if (!email || !password || !mode || !filePath) {   // Verifica se os parâmetros obrigatórios foram passados.
        return res.status(400).json({ error: "Email, senha, modo e caminho do arquivo são obrigatórios." });   // Retorna erro se faltar algum parâmetro.
    }

    try {
        const storage = new mega.Storage({ email, password }, async () => {   // Cria o armazenamento no Mega usando email e senha.
            console.log("Login bem-sucedido!");   // Mensagem de sucesso no login.

            const folderPath = path.dirname(filePath);   // Obtém o caminho da pasta onde o arquivo será armazenado.
            
            try {
                const folder = await ensureMegaFolderExists(storage, folderPath);   // Garante que a pasta exista no Mega.nz.
                console.log(`Pasta ${folderPath} verificada ou criada com sucesso.`);   // Mensagem de sucesso.

                if (mode === "upload" && req.file) {   // Se o modo for "upload" e o arquivo foi enviado.
                    const filePath = req.file.path;   // Caminho temporário do arquivo enviado.
                    const fileExtension = path.extname(req.file.originalname).toLowerCase();   // Extensão do arquivo.
                    let convertedFilePath;   // Caminho para o arquivo convertido.
                    let finalFilePath;   // Caminho final para o arquivo.
                    let originalFilePath;   // Caminho para o arquivo original.

                    if ([".jpg", ".jpeg", ".png"].includes(fileExtension)) {   // Se for uma imagem.
                        convertedFilePath = path.join(mediaDirectories.imagens, `${path.basename(req.file.originalname, fileExtension)}.webp`);   // Caminho da imagem convertida para WebP.
                        await convertImage(filePath, convertedFilePath);   // Converte a imagem.
                        finalFilePath = convertedFilePath;   // Define o caminho final.

                        originalFilePath = path.join(mediaDirectories.originais, "imagem", req.file.originalname);   // Caminho do arquivo original.
                    } else if ([".mp4", ".mov", ".avi"].includes(fileExtension)) {   // Se for um vídeo.
                        convertedFilePath = path.join(mediaDirectories.videos, `${path.basename(req.file.originalname, fileExtension)}.webm`);   // Caminho do vídeo convertido para WebM.
                        await convertVideo(filePath, convertedFilePath);   // Converte o vídeo.
                        finalFilePath = convertedFilePath;   // Define o caminho final.

                        originalFilePath = path.join(mediaDirectories.originais, "videos", req.file.originalname);   // Caminho do arquivo original.
                    } else if ([".mp3", ".wav", ".flac"].includes(fileExtension)) {   // Se for um áudio.
                        convertedFilePath = path.join(mediaDirectories.audios, `${path.basename(req.file.originalname, fileExtension)}.mp3`);   // Caminho do áudio comprimido.
                        await compressAudio(filePath, convertedFilePath);   // Comprime o áudio.
                        finalFilePath = convertedFilePath;   // Define o caminho final.

                        originalFilePath = path.join(mediaDirectories.originais, "audios", req.file.originalname);   // Caminho do arquivo original.
                    } else if (fileExtension === ".docx" || fileExtension === ".txt") {   // Se for um documento de texto.
                        convertedFilePath = await convertToPDF(filePath);   // Converte para PDF.
                        finalFilePath = convertedFilePath;   // Define o caminho final.

                        originalFilePath = path.join(mediaDirectories.originais, "documentos", req.file.originalname);   // Caminho do arquivo original.
                    } else if (fileExtension === ".pdf") {   // Se for um documento PDF.
                        finalFilePath = filePath;   // Mantém o caminho original.

                        originalFilePath = path.join(mediaDirectories.originais, "documentos", req.file.originalname);   // Caminho do arquivo original.
                    } else {   // Para outros tipos de arquivos.
                        finalFilePath = path.join(mediaDirectories.documentos, req.file.originalname);   // Caminho do arquivo final.
                        originalFilePath = path.join(mediaDirectories.originais, "documentos", req.file.originalname);   // Caminho do arquivo original.
                        fs.renameSync(filePath, finalFilePath);   // Move o arquivo para o caminho final.
                    }

                    fs.renameSync(req.file.path, originalFilePath);   // Move o arquivo original para a pasta de originais.

                    const originalFileStream = fs.createReadStream(originalFilePath);   // Cria um stream de leitura para o arquivo original.
                    const uploadOriginal = storage.upload(path.join("originais", path.basename(originalFilePath)), originalFileStream);   // Inicia o upload do arquivo original.
                    uploadOriginal.on("end", () => console.log("Arquivo original enviado para o Mega.nz."));   // Mensagem de sucesso quando o upload do original terminar.

                    const finalFileStream = fs.createReadStream(finalFilePath);   // Cria um stream de leitura para o arquivo final.
                    const uploadFinal = storage.upload(path.join(folderPath, path.basename(finalFilePath)), finalFileStream);   // Inicia o upload do arquivo final.
                    uploadFinal.on("end", () => console.log("Arquivo final enviado para o Mega.nz."));   // Mensagem de sucesso quando o upload final terminar.

                    res.status(200).json({ success: true, message: "Arquivo enviado com sucesso!" });   // Retorna sucesso para o usuário.
                }
            } catch (err) {
                console.error("Erro ao garantir a pasta no Mega.nz:", err);   // Loga o erro se a pasta não puder ser criada.
                res.status(500).json({ error: "Erro ao acessar ou criar pasta no Mega.nz." });   // Retorna erro se houver falha.
            }
        });
    } catch (err) {
        console.error("Erro no Mega login:", err);   // Loga o erro de login.
        res.status(500).json({ error: "Erro ao fazer login no Mega.nz." });   // Retorna erro se o login falhar.
    }
});

app.listen(port, () => {   // Inicia o servidor na porta definida.
    console.log(`Servidor rodando em http://localhost:${port}`);   // Mensagem indicando que o servidor está funcionando.
});
