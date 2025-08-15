FROM node:24
WORKDIR /usr/src/app
COPY . .
RUN npm install
RUN npm run build
EXPOSE 1984
EXPOSE 1984/udp
EXPOSE 1985
EXPOSE 1985/udp
ENV DEBUG="libp2p:*"
CMD npm start
