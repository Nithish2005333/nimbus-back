# Nimbus Cloud Backend

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` file:**
   ```env
   MONGO_URL=mongodb://localhost:27017/mycloud
   JWT_SECRET=your-secret-key-here
   PORT=5000
   STORAGE_PATH=./storage
   NODE_ENV=development
   ```

3. **Start server:**
   ```bash
   npm start
   ```

## MongoDB Setup

### Option 1: MongoDB Atlas (Cloud - Free)
1. Sign up at https://www.mongodb.com/cloud/atlas
2. Create free cluster
3. Get connection string
4. Update `MONGO_URL` in `.env`

### Option 2: Local MongoDB
1. Install MongoDB Community Server
2. Start MongoDB service
3. Use: `mongodb://localhost:27017/mycloud`

## API Endpoints

- `POST /auth/register` - Register user
- `POST /auth/login` - Login user
- `POST /upload` - Upload file (requires auth)
- `GET /files` or `/files/list` - Get files (requires auth)
- `GET /files/download/:id` - Download file (requires auth)
- `DELETE /files/:id` - Delete file (requires auth)
- `PATCH /files/rename/:id` - Rename file (requires auth)
- `PATCH /files/move/:id` - Move file (requires auth)

See `API_DOCS.md` for full documentation.

## Environment Variables

- `MONGO_URL` - MongoDB connection string (required)
- `JWT_SECRET` - Secret key for JWT tokens (required)
- `PORT` - Server port (default: 5000)
- `STORAGE_PATH` - File storage path (default: ./storage)
- `NODE_ENV` - Environment (development/production)

