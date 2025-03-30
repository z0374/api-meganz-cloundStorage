# Usando uma imagem oficial do Node.js
FROM node:16

# Definindo o diretório de trabalho
WORKDIR /usr/src/app

# Copiando o package.json e o package-lock.json
COPY package*.json ./

# Instalando as dependências
RUN npm install

# Copiando o código da aplicação
COPY . .

# Expondo a porta 3000
EXPOSE 3000

# Comando para iniciar a aplicação
CMD [ "node", "index.js" ]
