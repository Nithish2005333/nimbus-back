// Setup script to create .env file with proper values
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const envTemplate = `# MongoDB Connection
# For Local MongoDB (if MongoDB is installed locally):
MONGO_URL=mongodb://localhost:27017/mycloud

# For MongoDB Atlas (Cloud - Free):
# Uncomment and replace with your MongoDB Atlas connection string:
# MONGO_URL=mongodb+srv://username:password@cluster.mongodb.net/mycloud

# JWT Secret Key (Change this to a random secure string!)
JWT_SECRET=nimbus-cloud-secret-key-2024-change-in-production

# Server Port
PORT=5000

# Storage Path
STORAGE_PATH=./storage

# Environment
NODE_ENV=development
`;

// Check if .env already exists
if (fs.existsSync(envPath)) {
  console.log('✅ .env file already exists');
  console.log('📝 Please edit it manually to add your MongoDB connection string');
} else {
  // Create .env file
  fs.writeFileSync(envPath, envTemplate);
  console.log('✅ Created .env file');
  console.log('📝 Please edit .env file to add your MongoDB connection string');
  console.log('   Location:', envPath);
}

console.log('\n📋 Next steps:');
console.log('1. Edit .env file and set MONGO_URL');
console.log('   - Local MongoDB: mongodb://localhost:27017/mycloud');
console.log('   - MongoDB Atlas: Get connection string from https://www.mongodb.com/cloud/atlas');
console.log('2. Make sure MongoDB is running (if using local)');
console.log('3. Run: npm start');

