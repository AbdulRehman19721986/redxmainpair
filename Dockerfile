# Use official Node.js image
FROM node:20-bookworm

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install the application dependencies
RUN npm install

# Copy the rest of the application files into the container
COPY . .

# Render injects PORT at runtime — expose it
EXPOSE $PORT

# Command to run the app
CMD ["npm", "start"]
