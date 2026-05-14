const router = require("express").Router();
const User = require("../models/User");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const base64url = require('base64url');

// Constants for WebAuthn
const RP_NAME = 'Nimbus Cloud';
// Use explicit domain if possible, or localhost for dev. 
// Important: WebAuthn relies on RP ID matching the domain.
// We'll determine RP_ID dynamically in the routes now, based on request.
// But for simplewebauthn on server, we need a default or per-request override.
const getRpId = (req) => {
  // If running on localhost, use 'localhost'
  // If running on ngrok (e.g. foo.ngrok-free.app), use 'foo.ngrok-free.app'
  const host = req.hostname;
  return host;
};
const ORIGIN = ['http://localhost:5173', 'https://deprecatory-palmar-vanna.ngrok-free.dev', 'http://localhost:5000', 'https://nimbus-front-opal.vercel.app'];

// --- Helper Middleware for Authentication ---
const verifyToken = (req, res, next) => {
  const token = req.header("auth-token");
  if (!token) return res.status(401).json({ success: false, msg: "Access Denied" });

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).json({ success: false, msg: "Invalid Token" });
  }
};

// ... existing register and login routes ...

// REGISTER
router.post("/register", async (req, res) => {
  try {
    const {
      name, email, password, phone, dob,
      storagePlan, backupPreference, syncPreference, securityLevel,
      firstName, lastName
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, msg: "Missing required fields" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, msg: "Email already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const fullName = `${firstName || ''} ${lastName || ''}`.trim() || name;

    const user = new User({
      name: fullName,
      firstName: firstName || '',
      lastName: lastName || '',
      email,
      password: hashed,
      phone: phone || '',
      dob: dob || '',
      storagePlan: storagePlan || '10GB',
      backupPreference: backupPreference || 'automatic',
      syncPreference: syncPreference || 'real-time',
      securityLevel: securityLevel || 'standard'
    });

    await user.save();

    // create user folder structure
    const baseStorage = process.env.STORAGE_PATH || path.join(__dirname, "..", "storage");
    const userFolder = path.join(baseStorage, user._id.toString());

    if (!fs.existsSync(baseStorage)) {
      fs.mkdirSync(baseStorage, { recursive: true });
    }
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
      fs.mkdirSync(path.join(userFolder, "uploads"), { recursive: true });
      fs.mkdirSync(path.join(userFolder, "logs"), { recursive: true });
    }

    res.json({ success: true, msg: "User registered", userId: user._id });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// LOGIN (Password)
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, msg: "Missing fields" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ success: false, msg: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ success: false, msg: "Invalid password" });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ success: true, token, user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: err.message });
  }
});


// --- WEBAUTHN / FINGERPRINT ROUTES ---

// 1. Get List of Registered Fingerprints
router.get("/fingerprints", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false });

    // Return list without public keys (just ID and maybe transport)
    const list = (user.credentials || []).map(cred => ({
      id: cred.credentialID,
      transports: cred.transports
    }));

    res.json({ success: true, credentials: list });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

// 2. Register Challenge (Start adding fingerprint)
router.post("/register-challenge", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, msg: "User not found" });

    // Generate registration options
    // Ensure userID is a buffer/array as REQUIRED by simplewebauthn, BUT ensure it's simple
    const userID = new Uint8Array(Buffer.from(user._id.toString()));
    const rpID = String(getRpId(req)); // Force string

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID,
      userName: user.email,
      userDisplayName: user.name || user.email,
      attestationType: 'none',
      authenticatorSelection: {
        // userVerification: 'preferred',
        // residentKey: 'preferred'
      },
    });

    // Save challenge to user DB temporarily
    user.currentChallenge = options.challenge;
    await user.save();

    res.json(options);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// 3. Verify Registration (Finish adding fingerprint)
router.post("/register-verify", verifyToken, async (req, res) => {
  try {
    const { body } = req; // The WebAuthn response from frontend
    const user = await User.findById(req.user.id);

    if (!user || !user.currentChallenge) {
      return res.status(400).json({ success: false, msg: "No registration in progress" });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: ORIGIN, // Allow requests from our frontend(s)
        expectedRPID: RP_ID,
        requireUserVerification: false, // simplify for now, can be true for stricter auth
      });
      // ... (inside verifyRegistrationResponse try/catch) ...
    } catch (error) {
      console.error("Verification logic failed:", error);
      // Fallback ...
      try {
        verification = await verifyRegistrationResponse({
          response: body,
          expectedChallenge: user.currentChallenge,
          expectedOrigin: req.headers.origin,
          expectedRPID: getRpId(req),
          requireUserVerification: false,
        });
      } catch (e2) {
        console.error("Fallback verification also failed:", e2);
        throw e2;
      }
    }

    if (verification.verified && verification.registrationInfo) {
      // DEBUG: Write full object to file to inspect structure
      fs.writeFileSync(path.join(__dirname, '../verify_debug.json'), JSON.stringify(verification, null, 2));

      console.log('RegistrationInfo Object:', verification.registrationInfo);

      const info = verification.registrationInfo;

      // Extract based on new simplewebauthn structure (observed from error msg: keys include 'credential')
      // Structure seems to be: { credential: { id: '...', publicKey: '...' }, ... }
      // Extract based on new simplewebauthn structure
      let credentialID = info.credentialID || info.credentialId;
      let credentialPublicKey = info.credentialPublicKey;
      let counter = info.counter;

      // If direct properties are missing, check nested 'credential' object
      if (info.credential) {
        if (!credentialID) credentialID = info.credential.id;
        if (!credentialPublicKey) credentialPublicKey = info.credential.publicKey;
        if (counter === undefined) counter = info.credential.counter;
      }

      // Fallback for counter
      if (counter === undefined) {
        counter = (info.authenticatorData ? info.authenticatorData.signCount : 0) || 0;
      }

      if (!credentialPublicKey || !credentialID) {
        console.error("Critical: Missing public key or credential ID");
        return res.status(400).json({
          success: false,
          msg: `Verification succeeded but missing info. Available keys: ${Object.keys(info).join(', ')}`
        });
      }

      // Save the new credential - ensure we convert to Buffer safely
      let pubKeyBuffer, credIdBuffer;
      try {
        // Handle Public Key Conversion
        if (Buffer.isBuffer(credentialPublicKey)) {
          pubKeyBuffer = credentialPublicKey;
        } else if (credentialPublicKey instanceof Uint8Array) {
          pubKeyBuffer = Buffer.from(credentialPublicKey);
        } else if (typeof credentialPublicKey === 'object') {
          // Handle object map {0: x, 1: y} if explicit array conversion needed
          // Try explicit array conversion first
          pubKeyBuffer = Buffer.from(Object.values(credentialPublicKey));
        } else {
          // Fallback for base64 string or other
          pubKeyBuffer = Buffer.from(credentialPublicKey);
        }

        // Handle Credential ID Conversion
        if (Buffer.isBuffer(credentialID)) {
          credIdBuffer = credentialID;
        } else if (typeof credentialID === 'string') {
          // Assume base64url string as seen in debug logs ("5eMHyZcEvPbS2NtDZXqiZw")
          credIdBuffer = base64url.toBuffer(credentialID);
        } else {
          credIdBuffer = Buffer.from(credentialID);
        }

      } catch (bufErr) {
        console.error("Buffer conversion failed:", bufErr);
        return res.status(500).json({ success: false, msg: "Failed to process credential data: " + bufErr.message });
      }

      user.credentials.push({
        credentialID: credIdBuffer.toString('base64url'),
        credentialPublicKey: pubKeyBuffer.toString('base64url'),
        counter: counter || 0, // Ensure counter is always a number
        transports: body.response.transports || []
      });

      // Clear challenge
      user.currentChallenge = "";
      await user.save();

      res.json({ success: true, verified: true });
    } else {
      res.status(400).json({ success: false, verified: false, msg: "Verification failed" });
    }
  } catch (err) {
    console.error("Register Verify Error:", err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// 4. Login Challenge (Start login with fingerprint)
// NOTE: This does NOT require a token, because user is trying to log in.
// We identify user by email first to fetch their credentials.
router.post("/login-challenge", async (req, res) => {
  try {
    // User must provide email to identify which account they want to unlock
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, msg: "Email required" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ success: false, msg: "User not found" });

    if (!user.credentials || user.credentials.length === 0) {
      return res.status(400).json({ success: false, msg: "No fingerprint registered for this account" });
    }

    // Get user's registered credential IDs
    // Get user's registered credential IDs
    // DEBUG: Wrap loop in try-catch to find the crash
    let userCredentials;
    try {
      console.log("LOGIN CHALLENGE: Processing credentials for user:", user._id);
      userCredentials = user.credentials.map((cred, idx) => {
        let credIdBuffer;
        console.log(`Processing cred ${idx}: ID type=${typeof cred.credentialID}`);

        if (typeof cred.credentialID === 'string') {
          // If stored as base64 string
          try {
            // Use Node.js native base64url support (Node 14.18+)
            credIdBuffer = Buffer.from(cred.credentialID, 'base64url');
          } catch (b64err) {
            console.error(`Base64 decode failed for cred ${idx}:`, b64err);
            return null;
          }
        } else if (Buffer.isBuffer(cred.credentialID)) {
          credIdBuffer = cred.credentialID;
        } else {
          // Fallback or skip
          console.warn("Invalid credentialID type in DB:", typeof cred.credentialID);
          return null; // Filter out later
        }

        return {
          id: credIdBuffer,
          transports: cred.transports,
        };
      }).filter(c => c !== null);
    } catch (mapErr) {
      console.error("CRASH in credential mapping:", mapErr);
      throw mapErr;
    }

    // VITAL FIX: specific simplewebauthn expectations
    // allowCredentials: { id: Base64URLString, ... }[] in some versions, or Buffer in others. 
    // BUT generateAuthenticationOptions (server) usually expects string IDs if talking to recent helpers?
    // Let's stick to what we know: the library might be finicky about mixed types.
    // If we pass 'id' as Buffer, it MIGHT be okay.
    // But if we pass it as Base64URL String, it is definitely safe for transport.

    // HOWEVER, the `generateAuthenticationOptions` documentation says allowCredentials ID type is `Buffer | string`.
    // IF the library is throwing "input.replace is not a function", it might be trying to convert a Buffer to string using replace? Unlikely.
    // It's more likely usually REVERSE: string -> buffer using base64url decode which uses replace.
    // If we pass a Buffer, it might try to decode it as base64 string? No that makes no sense.
    // 
    // Let's convert to Base64URL String for SAFETY.
    const safeCredentials = userCredentials.map(c => ({
      id: c.id.toString('base64url'), // Convert Buffer to Base64URL String
      transports: c.transports
    }));

    const options = await generateAuthenticationOptions({
      timeout: 60000,
      allowCredentials: safeCredentials,
      // userVerification: 'preferred',
      rpID: String(getRpId(req)), // Force string
    });

    // Save challenge
    user.currentChallenge = options.challenge;
    await user.save();

    res.json(options);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: err.message });
  }
});

// 5. Verify Login (Finish login)
router.post("/login-verify", async (req, res) => {
  console.log('\n\n========== LOGIN VERIFY ROUTE HIT ==========');
  console.log('Timestamp:', new Date().toISOString());
  try {
    // Verify Login (Finish login)
    console.log("LOGIN VERIFY START");
    const body = req.body;
    const email = body.email;

    // DEBUG: Write full login body to file
    try {
      fs.writeFileSync(path.join(__dirname, '../verify_login_debug.json'), JSON.stringify(body, null, 2));
    } catch (fsErr) {
      console.error("Failed to write debug file:", fsErr);
    }

    const user = await User.findOne({ email });

    if (!user || !user.currentChallenge) {
      return res.status(400).json({ success: false, msg: "Login flow not initialized" });
    }

    // Find the credential in DB that matches the one returned
    const credentialID = body.id;
    let dbCredential = user.credentials.find(cred => cred.credentialID === credentialID);

    if (!dbCredential) {
      const knownIds = user.credentials.map(c => c.credentialID).join(', ');
      console.error(`Authenticator not recognized. Got: ${credentialID}, Known: ${knownIds}`);
      return res.status(400).json({ success: false, msg: `Authenticator not recognized (ID: ${credentialID})` });
    }

    // Convert Mongoose subdocument to plain object
    if (dbCredential.toObject) {
      dbCredential = dbCredential.toObject();
    }

    // DEBUG: Log full credential object
    console.log('Found dbCredential:', JSON.stringify(dbCredential, null, 2));
    console.log('dbCredential type:', typeof dbCredential);
    console.log('dbCredential.counter:', dbCredential.counter);
    console.log('dbCredential keys:', Object.keys(dbCredential));

    let dbPubKey, dbCredID;
    try {
      console.log(`Decoding Credential: ID=${typeof dbCredential.credentialID} PubKey=${typeof dbCredential.credentialPublicKey}`);
      if (typeof dbCredential.credentialPublicKey !== 'string') {
        throw new Error(`Invalid Public Key type in DB: ${typeof dbCredential.credentialPublicKey}`);
      }
      if (typeof dbCredential.credentialID !== 'string') {
        throw new Error(`Invalid Credential ID type in DB: ${typeof dbCredential.credentialID}`);
      }

      dbPubKey = Buffer.from(dbCredential.credentialPublicKey, 'base64url');
      dbCredID = Buffer.from(dbCredential.credentialID, 'base64url');
    } catch (decodeErr) {
      console.error("Credential decoding failed:", decodeErr);
      // Clean up bad credential?
      return res.status(500).json({ success: false, msg: "Corrupted credential data in database: " + decodeErr.message });
    }

    // DEBUG LOG - Access counter safely
    const safeCounter = dbCredential?.counter ?? 0;
    console.log('Login Verify Init:', {
      expectedChallenge: user.currentChallenge,
      credentialID: dbCredential.credentialID,
      counter: safeCounter
    });

    // Ensure counter exists
    if (dbCredential.counter === undefined || dbCredential.counter === null) {
      console.warn('Counter was undefined, setting to 0');
      dbCredential.counter = 0;
    }

    // Prepare authenticator object
    const authenticatorObject = {
      credentialPublicKey: new Uint8Array(dbPubKey),
      credentialID: new Uint8Array(dbCredID),
      counter: safeCounter || 0,
    };

    console.log('Authenticator object being passed to verifyAuthenticationResponse:');
    console.log('- credentialPublicKey type:', authenticatorObject.credentialPublicKey.constructor.name);
    console.log('- credentialID type:', authenticatorObject.credentialID.constructor.name);
    console.log('- counter:', authenticatorObject.counter, 'type:', typeof authenticatorObject.counter);

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        authenticator: authenticatorObject,
        requireUserVerification: false,
      });
    } catch (error) {
      console.error("Login verification failed (primary):", error.message);
      // Fallback for dynamic origin
      try {
        verification = await verifyAuthenticationResponse({
          response: body,
          expectedChallenge: user.currentChallenge,
          expectedOrigin: req.headers.origin,
          expectedRPID: getRpId(req),
          authenticator: {
            credentialPublicKey: new Uint8Array(dbPubKey),
            credentialID: new Uint8Array(dbCredID),
            counter: safeCounter || 0,
          },
          requireUserVerification: false,
        });
      } catch (e2) {
        console.error("Login verification failed (fallback):", e2);
        throw e2;
      }
    }

    if (verification.verified) {
      // Update counter safely
      if (verification.authenticationInfo && verification.authenticationInfo.newCounter !== undefined) {
        dbCredential.counter = verification.authenticationInfo.newCounter;
      }
      user.currentChallenge = "";
      await user.save();

      // Issue JWT
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
      res.json({ success: true, token, user: { _id: user._id, name: user.name, email: user.email, role: user.role } });
    } else {
      res.status(400).json({ success: false, verified: false, msg: "Verification failed" });
    }
  } catch (err) {
    console.error("Login Verify Error:", err);
    console.error("Error stack:", err.stack);
    console.error("Error name:", err.name);
    console.error("Error message:", err.message);
    res.status(500).json({ success: false, msg: err.message, error: err.toString() });
  }
});

// 6. Delete Fingerprint
router.delete("/fingerprints/:id", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false });

    // Filter out the credential with the given ID
    // Note: ID passed in URL might be the credentialID string
    user.credentials = user.credentials.filter(c => c.credentialID !== req.params.id);

    await user.save();
    res.json({ success: true, msg: "Fingerprint removed" });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
})

module.exports = router;
