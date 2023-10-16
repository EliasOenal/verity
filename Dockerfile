FROM node:18
WORKDIR /usr/src/app
COPY . .
RUN npm install
EXPOSE 1984
EXPOSE 1984/udp
CMD npm run build
ENV DEBUG="libp2p:*"
CMD npm start
