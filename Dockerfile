# Use the Node.js 18 Alpine image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json to the working directory
COPY package.json ./

# Install project dependencies
RUN npm install

# Copy the rest of the application files to the container
COPY . .

# Expose the port that the app will run on
EXPOSE 5001

# Start the Node.js app
CMD ["node", "app.js"]