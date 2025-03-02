FROM node:23.9.0-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --quiet --no-progress

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start:prod"]