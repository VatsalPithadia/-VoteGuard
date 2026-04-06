# Auth0 Token Vault Implementation Guide

## Overview

This guide implements a secure token management system for your civic tech web app using Auth0 Token Vault. The system ensures that AI agents never access user credentials directly, instead receiving temporary scoped tokens from the Vault.

## Architecture

```
React Frontend → Auth0 Login → Token Vault → Backend API → AI Agent (Temporary Token)
```

## 1. Auth0 Tenant Setup

### 1.1 Create Regular Web Application (React Frontend)

1. Go to Auth0 Dashboard → Applications → Applications → Create Application
2. Select **Regular Web Applications**
3. Name: `Voter Verification App`
4. Configure settings:

**Basic Settings:**
- Application Login URI: `http://localhost:3000`
- Allowed Callback URLs: `http://localhost:3000`
- Allowed Logout URLs: `http://localhost:3000`
- Allowed Web Origins: `http://localhost:3000`

**Advanced Settings:**
- Grant Types: Authorization Code, Implicit (Hybrid)
- Token Endpoint Authentication Method: None
- Response Type: code

### 1.2 Create Machine-to-Machine Application (Backend API)

1. Create another application → **Machine to Machine Applications**
2. Name: `Voter Verification Backend`
3. Select API: `Auth0 Management API`
4. Grant permissions:
   - `read:users`
   - `read:user_idp_tokens`
   - `create:users`
   - `update:users`

### 1.3 Create Custom API for Your Backend

1. Go to Applications → APIs → Create API
2. Name: `Voter Verification API`
3. Identifier: `https://voter-verification-api`
4. Signing Algorithm: RS256
5. Enable RBAC: Yes
6. Add permissions:
   - `read:voter_data`
   - `verify:identity`
   - `access:token_vault`

## 2. Token Vault Configuration

### 2.1 Enable Token Vault

1. Go to **Advanced Settings** → **Token Vault**
2. Enable Token Vault
3. Configure settings:
   - Token Lifetime: 1 hour
   - Refresh Token Rotation: On
   - Reuse Refresh Token: No

### 2.2 Configure Social Connections

**Google Connection:**
1. Authentication → Social → Google
2. Enable connection
3. Configure Google OAuth credentials
4. Set **Store Tokens in Token Vault** to **Enabled**

**Microsoft Connection:**
1. Authentication → Social → Microsoft
2. Enable connection
3. Configure Microsoft OAuth credentials
4. Set **Store Tokens in Token Vault** to **Enabled**

### 2.3 Token Vault API Permissions

Add these permissions to your Backend API:
- `read:user_idp_tokens`
- `delete:user_idp_tokens`
- `create:user_idp_tokens`

## 3. Backend Implementation (Node.js/Express)

### 3.1 Package Dependencies

```bash
npm install express express-oauth2-jwt-bearer cors dotenv axios
npm install -D @types/node @types/express typescript ts-node
```

### 3.2 Environment Variables (.env)

```env
# Auth0 Configuration
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://voter-verification-api
AUTH0_ISSUER=https://your-tenant.auth0.com/

# Backend Application Credentials
BACKEND_CLIENT_ID=your-backend-client-id
BACKEND_CLIENT_SECRET=your-backend-client-secret

# Token Vault Configuration
TOKEN_VAULT_LIFETIME=3600
AI_AGENT_SCOPE=read:voter_data verify:identity

# Server Configuration
PORT=3001
NODE_ENV=development
```

### 3.3 JWT Validation Middleware

```typescript
// middleware/auth.ts
import { auth, requiredScopes } from 'express-oauth2-jwt-bearer';

export const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER,
  tokenSigningAlg: 'RS256',
});

export const requireVoterDataAccess = requiredScopes('read:voter_data');
export const requireIdentityVerification = requiredScopes('verify:identity');
export const requireTokenVaultAccess = requiredScopes('access:token_vault');
```

### 3.4 Token Vault Service

```typescript
// services/tokenVaultService.ts
import axios from 'axios';

export class TokenVaultService {
  private managementApiToken: string = '';
  private tokenExpiry: number = 0;

  private async getManagementApiToken(): Promise<string> {
    if (this.managementApiToken && Date.now() < this.tokenExpiry) {
      return this.managementApiToken;
    }

    const response = await axios.post(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
      client_id: process.env.BACKEND_CLIENT_ID,
      client_secret: process.env.BACKEND_CLIENT_SECRET,
      audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type: 'client_credentials'
    });

    this.managementApiToken = response.data.access_token;
    this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
    
    return this.managementApiToken;
  }

  async getStoredTokens(userId: string): Promise<any> {
    const token = await this.getManagementApiToken();
    
    try {
      const response = await axios.get(
        `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${userId}/identities`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return response.data;
    } catch (error) {
      console.error('Error fetching stored tokens:', error);
      throw new Error('Failed to retrieve stored tokens');
    }
  }

  async generateScopedToken(userId: string, requestedScopes: string[]): Promise<string> {
    const token = await this.getManagementApiToken();
    
    try {
      // Create a temporary access token with limited scope
      const response = await axios.post(
        `https://${process.env.AUTH0_DOMAIN}/oauth/token`,
        {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          client_id: process.env.BACKEND_CLIENT_ID,
          client_secret: process.env.BACKEND_CLIENT_SECRET,
          subject_token: await this.getUserAccessToken(userId),
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          scope: requestedScopes.join(' '),
          audience: process.env.AUTH0_AUDIENCE
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      return response.data.access_token;
    } catch (error) {
      console.error('Error generating scoped token:', error);
      throw new Error('Failed to generate scoped token');
    }
  }

  private async getUserAccessToken(userId: string): Promise<string> {
    // In a real implementation, you'd retrieve the user's stored access token
    // from the Token Vault or your secure storage
    throw new Error('User access token retrieval not implemented');
  }

  async revokeUserTokens(userId: string): Promise<void> {
    const token = await this.getManagementApiToken();
    
    try {
      await axios.delete(
        `https://${process.env.AUTH0_DOMAIN}/api/v2/users/${userId}/identities`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error revoking tokens:', error);
      throw new Error('Failed to revoke user tokens');
    }
  }
}
```

### 3.5 AI Agent Token Exchange Endpoint

```typescript
// routes/aiAgent.ts
import express from 'express';
import { TokenVaultService } from '../services/tokenVaultService';
import { checkJwt, requireTokenVaultAccess } from '../middleware/auth';

const router = express.Router();
const tokenVaultService = new TokenVaultService();

// AI Agent requests temporary token
router.post('/request-token', 
  checkJwt, 
  requireTokenVaultAccess,
  async (req, res) => {
    try {
      const { userId, requestedScopes } = req.body;
      
      if (!userId || !requestedScopes || !Array.isArray(requestedScopes)) {
        return res.status(400).json({ 
          error: 'userId and requestedScopes array are required' 
        });
      }

      // Validate requested scopes
      const allowedScopes = ['read:voter_data', 'verify:identity'];
      const invalidScopes = requestedScopes.filter(scope => !allowedScopes.includes(scope));
      
      if (invalidScopes.length > 0) {
        return res.status(400).json({ 
          error: `Invalid scopes requested: ${invalidScopes.join(', ')}` 
        });
      }

      // Generate temporary scoped token
      const temporaryToken = await tokenVaultService.generateScopedToken(
        userId, 
        requestedScopes
      );

      res.json({
        access_token: temporaryToken,
        token_type: 'Bearer',
        expires_in: parseInt(process.env.TOKEN_VAULT_LIFETIME || '3600'),
        scope: requestedScopes.join(' ')
      });

    } catch (error) {
      console.error('Token request error:', error);
      res.status(500).json({ error: 'Failed to generate temporary token' });
    }
  }
);

// AI Agent revokes token after use
router.post('/revoke-token', 
  checkJwt, 
  requireTokenVaultAccess,
  async (req, res) => {
    try {
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      await tokenVaultService.revokeUserTokens(userId);
      
      res.json({ message: 'Token revoked successfully' });

    } catch (error) {
      console.error('Token revocation error:', error);
      res.status(500).json({ error: 'Failed to revoke token' });
    }
  }
);

export default router;
```

### 3.6 Main Server File

```typescript
// server.ts
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import aiAgentRoutes from './routes/aiAgent';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

// Routes
app.use('/api/ai-agent', aiAgentRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

## 4. React Frontend Implementation

### 4.1 Package Dependencies

```bash
npm install @auth0/auth0-react axios
```

### 4.2 Auth0 Configuration (.env)

```env
REACT_APP_AUTH0_DOMAIN=your-tenant.auth0.com
REACT_APP_AUTH0_CLIENT_ID=your-frontend-client-id
REACT_APP_AUTH0_AUDIENCE=https://voter-verification-api
REACT_APP_API_BASE_URL=http://localhost:3001
```

### 4.3 Auth0 Provider Setup

```typescript
// src/App.tsx
import React from 'react';
import { Auth0Provider } from '@auth0/auth0-react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import VoterVerification from './components/VoterVerification';

const domain = process.env.REACT_APP_AUTH0_DOMAIN;
const clientId = process.env.REACT_APP_AUTH0_CLIENT_ID;
const audience = process.env.REACT_APP_AUTH0_AUDIENCE;

function App() {
  return (
    <Auth0Provider
      domain={domain!}
      clientId={clientId!}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: audience,
        scope: 'openid profile email read:voter_data verify:identity'
      }}
    >
      <Router>
        <div className="App">
          <Routes>
            <Route path="/" element={<Login />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/verify" element={<VoterVerification />} />
          </Routes>
        </div>
      </Router>
    </Auth0Provider>
  );
}

export default App;
```

### 4.4 Login Component

```typescript
// src/components/Login.tsx
import React from 'react';
import { useAuth0 } from '@auth0/auth0-react';

const Login: React.FC = () => {
  const { loginWithRedirect, isAuthenticated, isLoading } = useAuth0();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isAuthenticated) {
    window.location.href = '/dashboard';
    return null;
  }

  return (
    <div className="login-container">
      <h1>Voter Verification System</h1>
      <p>Secure identity verification using Auth0 Token Vault</p>
      
      <div className="login-buttons">
        <button onClick={() => loginWithRedirect()}>
          Login with Email
        </button>
        <button onClick={() => loginWithRedirect({
          authorizationParams: {
            connection: 'google-oauth2'
          }
        })}>
          Login with Google
        </button>
        <button onClick={() => loginWithRedirect({
          authorizationParams: {
            connection: 'windowslive'
          }
        })}>
          Login with Microsoft
        </button>
      </div>
    </div>
  );
};

export default Login;
```

### 4.5 Dashboard Component

```typescript
// src/components/Dashboard.tsx
import React, { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import axios from 'axios';

interface UserProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
}

const Dashboard: React.FC = () => {
  const { user, isAuthenticated, getAccessTokenSilently, logout } = useAuth0();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [tokenInfo, setTokenInfo] = useState<any>(null);

  useEffect(() => {
    if (isAuthenticated && user) {
      setUserProfile({
        sub: user.sub!,
        email: user.email!,
        name: user.name!,
        picture: user.picture!
      });

      // Get token info for demonstration
      getTokenInfo();
    }
  }, [isAuthenticated, user]);

  const getTokenInfo = async () => {
    try {
      const token = await getAccessTokenSilently();
      const payload = JSON.parse(atob(token.split('.')[1]));
      setTokenInfo(payload);
    } catch (error) {
      console.error('Error getting token info:', error);
    }
  };

  const initiateVerification = async () => {
    try {
      const token = await getAccessTokenSilently();
      
      const response = await axios.post(
        `${process.env.REACT_APP_API_BASE_URL}/api/verification/initiate`,
        { userId: user?.sub },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Verification initiated:', response.data);
      // Redirect to verification page
      window.location.href = '/verify';
    } catch (error) {
      console.error('Error initiating verification:', error);
    }
  };

  if (!isAuthenticated) {
    return <div>Please log in to access the dashboard.</div>;
  }

  return (
    <div className="dashboard">
      <header>
        <h1>Welcome, {user?.name}</h1>
        <button onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
          Logout
        </button>
      </header>

      <main>
        <section className="user-info">
          <img src={user?.picture} alt={user?.name} />
          <p><strong>Email:</strong> {user?.email}</p>
          <p><strong>User ID:</strong> {user?.sub}</p>
        </section>

        <section className="token-info">
          <h2>Your Token Information</h2>
          {tokenInfo && (
            <div>
              <p><strong>Expires:</strong> {new Date(tokenInfo.exp * 1000).toLocaleString()}</p>
              <p><strong>Scopes:</strong> {tokenInfo.scope}</p>
              <p><strong>Audience:</strong> {tokenInfo.aud}</p>
            </div>
          )}
        </section>

        <section className="actions">
          <h2>Voter Verification</h2>
          <p>Your identity token is securely stored in Auth0 Token Vault.</p>
          <button onClick={initiateVerification}>
            Start Identity Verification
          </button>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
```

### 4.6 Voter Verification Component

```typescript
// src/components/VoterVerification.tsx
import React, { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import axios from 'axios';

interface VerificationStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  message: string;
  aiAgentResponse?: any;
}

const VoterVerification: React.FC = () => {
  const { user, getAccessTokenSilently } = useAuth0();
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>({
    status: 'pending',
    message: 'Initializing verification process...'
  });

  useEffect(() => {
    if (user) {
      startVerificationProcess();
    }
  }, [user]);

  const startVerificationProcess = async () => {
    try {
      const token = await getAccessTokenSilently();
      
      // Step 1: Request AI agent to start verification
      const response = await axios.post(
        `${process.env.REACT_APP_API_BASE_URL}/api/verification/process`,
        { 
          userId: user?.sub,
          verificationType: 'identity_and_constituency'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      setVerificationStatus({
        status: 'processing',
        message: 'AI agent is verifying your identity...',
        aiAgentResponse: response.data
      });

      // Step 2: Poll for verification completion
      pollVerificationStatus(response.data.verificationId);

    } catch (error) {
      console.error('Verification error:', error);
      setVerificationStatus({
        status: 'failed',
        message: 'Verification failed. Please try again.'
      });
    }
  };

  const pollVerificationStatus = async (verificationId: string) => {
    const pollInterval = setInterval(async () => {
      try {
        const token = await getAccessTokenSilently();
        const response = await axios.get(
          `${process.env.REACT_APP_API_BASE_URL}/api/verification/status/${verificationId}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );

        if (response.data.status === 'completed') {
          clearInterval(pollInterval);
          setVerificationStatus({
            status: 'completed',
            message: 'Verification completed successfully!',
            aiAgentResponse: response.data
          });
        } else if (response.data.status === 'failed') {
          clearInterval(pollInterval);
          setVerificationStatus({
            status: 'failed',
            message: response.data.message || 'Verification failed'
          });
        }
      } catch (error) {
        clearInterval(pollInterval);
        setVerificationStatus({
          status: 'failed',
          message: 'Error checking verification status'
        });
      }
    }, 2000);
  };

  const getStatusColor = () => {
    switch (verificationStatus.status) {
      case 'processing': return '#FFA500';
      case 'completed': return '#28A745';
      case 'failed': return '#DC3545';
      default: return '#6C757D';
    }
  };

  return (
    <div className="verification-container">
      <h1>Voter Identity Verification</h1>
      
      <div className="status-indicator" style={{ color: getStatusColor() }}>
        <div className={`status-icon ${verificationStatus.status}`}></div>
        <p>{verificationStatus.message}</p>
      </div>

      {verificationStatus.aiAgentResponse && (
        <div className="verification-details">
          <h3>Verification Details</h3>
          <pre>{JSON.stringify(verificationStatus.aiAgentResponse, null, 2)}</pre>
        </div>
      )}

      <div className="security-info">
        <h3>🔒 Security Information</h3>
        <ul>
          <li>Your identity token is stored securely in Auth0 Token Vault</li>
          <li>AI agents receive temporary scoped tokens only</li>
          <li>No raw credentials are ever exposed to the AI system</li>
          <li>All token exchanges are logged and audited</li>
        </ul>
      </div>
    </div>
  );
};

export default VoterVerification;
```

## 5. AI Agent Implementation

### 5.1 AI Agent Service

```typescript
// services/aiAgentService.ts
import axios from 'axios';

export class AIAgentService {
  private backendUrl: string;
  private temporaryToken: string = '';
  private tokenExpiry: number = 0;

  constructor(backendUrl: string) {
    this.backendUrl = backendUrl;
  }

  async requestTemporaryToken(userId: string, scopes: string[]): Promise<string> {
    try {
      // AI agent requests a temporary token from the backend
      const response = await axios.post(
        `${this.backendUrl}/api/ai-agent/request-token`,
        {
          userId,
          requestedScopes: scopes
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-AI-Agent-ID': 'voter-verification-agent-v1'
          }
        }
      );

      this.temporaryToken = response.data.access_token;
      this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);

      return this.temporaryToken;
    } catch (error) {
      console.error('Failed to request temporary token:', error);
      throw new Error('AI agent authentication failed');
    }
  }

  async verifyVoterIdentity(userId: string): Promise<any> {
    try {
      // Request token with voter verification scope
      const token = await this.requestTemporaryToken(userId, ['verify:identity']);

      // Use temporary token to access voter data
      const response = await axios.get(
        `${this.backendUrl}/api/voter/identity/${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Voter identity verification failed:', error);
      throw error;
    }
  }

  async getVoterConstituency(userId: string): Promise<any> {
    try {
      // Request token with voter data scope
      const token = await this.requestTemporaryToken(userId, ['read:voter_data']);

      // Use temporary token to access constituency data
      const response = await axios.get(
        `${this.backendUrl}/api/voter/constituency/${userId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      console.error('Constituency data retrieval failed:', error);
      throw error;
    }
  }

  async revokeToken(userId: string): Promise<void> {
    try {
      await axios.post(
        `${this.backendUrl}/api/ai-agent/revoke-token`,
        { userId },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-AI-Agent-ID': 'voter-verification-agent-v1'
          }
        }
      );

      this.temporaryToken = '';
      this.tokenExpiry = 0;
    } catch (error) {
      console.error('Token revocation failed:', error);
      throw error;
    }
  }

  async performCompleteVerification(userId: string): Promise<any> {
    const verificationResults = {
      identityVerification: null,
      constituencyData: null,
      timestamp: new Date().toISOString(),
      success: false
    };

    try {
      // Step 1: Verify identity
      verificationResults.identityVerification = await this.verifyVoterIdentity(userId);

      // Step 2: Get constituency data
      verificationResults.constituencyData = await this.getVoterConstituency(userId);

      verificationResults.success = true;

      // Step 3: Clean up - revoke temporary token
      await this.revokeToken(userId);

      return verificationResults;
    } catch (error) {
      // Always attempt to revoke token on error
      try {
        await this.revokeToken(userId);
      } catch (revokeError) {
        console.error('Failed to revoke token after error:', revokeError);
      }

      throw error;
    }
  }
}
```

### 5.2 Verification Processing Endpoint

```typescript
// routes/verification.ts
import express from 'express';
import { AIAgentService } from '../services/aiAgentService';
import { checkJwt, requireVoterDataAccess } from '../middleware/auth';

const router = express.Router();
const aiAgent = new AIAgentService('http://localhost:3001');

// Store verification sessions in memory (use Redis in production)
const verificationSessions = new Map();

router.post('/process', 
  checkJwt, 
  requireVoterDataAccess,
  async (req, res) => {
    try {
      const { userId, verificationType } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: 'userId is required' });
      }

      // Generate verification ID
      const verificationId = `verif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store verification session
      verificationSessions.set(verificationId, {
        userId,
        status: 'processing',
        startTime: new Date().toISOString(),
        verificationType
      });

      // Start async verification process
      processVerificationAsync(verificationId, userId);

      res.json({
        verificationId,
        status: 'processing',
        message: 'Verification started'
      });

    } catch (error) {
      console.error('Verification processing error:', error);
      res.status(500).json({ error: 'Failed to start verification' });
    }
  }
);

async function processVerificationAsync(verificationId: string, userId: string) {
  try {
    // AI agent performs complete verification
    const results = await aiAgent.performCompleteVerification(userId);
    
    // Update session with results
    const session = verificationSessions.get(verificationId);
    if (session) {
      session.status = 'completed';
      session.results = results;
      session.endTime = new Date().toISOString();
      verificationSessions.set(verificationId, session);
    }
  } catch (error) {
    console.error('Async verification failed:', error);
    
    // Update session with error
    const session = verificationSessions.get(verificationId);
    if (session) {
      session.status = 'failed';
      session.error = error.message;
      session.endTime = new Date().toISOString();
      verificationSessions.set(verificationId, session);
    }
  }
}

router.get('/status/:verificationId', 
  checkJwt,
  async (req, res) => {
    try {
      const { verificationId } = req.params;
      const session = verificationSessions.get(verificationId);
      
      if (!session) {
        return res.status(404).json({ error: 'Verification session not found' });
      }

      res.json(session);
    } catch (error) {
      console.error('Status check error:', error);
      res.status(500).json({ error: 'Failed to check verification status' });
    }
  }
);

export default router;
```

## 6. Complete Environment Configuration

### 6.1 Backend .env

```env
# Auth0 Configuration
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://voter-verification-api
AUTH0_ISSUER=https://your-tenant.auth0.com/

# Backend Application (Machine-to-Machine)
BACKEND_CLIENT_ID=your-backend-client-id
BACKEND_CLIENT_SECRET=your-backend-client-secret

# Token Vault Configuration
TOKEN_VAULT_LIFETIME=3600
AI_AGENT_SCOPE=read:voter_data verify:identity

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration
FRONTEND_URL=http://localhost:3000

# AI Agent Configuration
AI_AGENT_ID=voter-verification-agent-v1
AI_AGENT_SECRET=your-ai-agent-secret

# Database (if needed for verification data)
DATABASE_URL=your-database-connection-string
```

### 6.2 Frontend .env

```env
# Auth0 Frontend Configuration
REACT_APP_AUTH0_DOMAIN=your-tenant.auth0.com
REACT_APP_AUTH0_CLIENT_ID=your-frontend-client-id
REACT_APP_AUTH0_AUDIENCE=https://voter-verification-api

# API Configuration
REACT_APP_API_BASE_URL=http://localhost:3001

# Application Configuration
REACT_APP_APP_NAME=Voter Verification System
REACT_APP_VERSION=1.0.0
```

## 7. Auth0 Dashboard Settings Summary

### 7.1 Applications Settings

**Frontend Application:**
- Type: Regular Web Application
- Callback URLs: `http://localhost:3000`
- Logout URLs: `http://localhost:3000`
- Origins: `http://localhost:3000`
- Grant Types: Authorization Code, Implicit (Hybrid)

**Backend Application:**
- Type: Machine to Machine
- API: Auth0 Management API
- Permissions: `read:users`, `read:user_idp_tokens`, `create:users`, `update:users`

### 7.2 API Settings

**Voter Verification API:**
- Identifier: `https://voter-verification-api`
- Signing Algorithm: RS256
- RBAC: Enabled
- Permissions: `read:voter_data`, `verify:identity`, `access:token_vault`

### 7.3 Token Vault Settings

- Enable Token Vault: Yes
- Token Lifetime: 1 hour
- Refresh Token Rotation: On
- Reuse Refresh Token: No
- Store Social Connection Tokens: Yes

### 7.4 Social Connections

**Google:**
- Enabled: Yes
- Store Tokens: Yes
- Scopes: email, profile

**Microsoft:**
- Enabled: Yes
- Store Tokens: Yes
- Scopes: email, profile

## 8. Security Best Practices

### 8.1 Token Management

1. **Use short-lived tokens**: Set appropriate expiry times
2. **Implement token rotation**: Regularly refresh tokens
3. **Scope limitation**: Request minimum necessary scopes
4. **Secure storage**: Never store tokens in localStorage

### 8.2 AI Agent Security

1. **Temporary access**: AI agents get time-limited tokens
2. **Scoped permissions**: Only access necessary data
3. **Automatic revocation**: Tokens revoked after use
4. **Audit logging**: Track all token exchanges

### 8.3 Monitoring and Logging

```typescript
// middleware/logging.ts
import { Request, Response, NextFunction } from 'express';

export const auditLogger = (req: Request, res: Response, next: NextFunction) => {
  const timestamp = new Date().toISOString();
  const userAgent = req.get('User-Agent');
  const ip = req.ip;
  
  console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${ip} - User-Agent: ${userAgent}`);
  
  // Log token exchanges
  if (req.path.includes('/token') || req.path.includes('/ai-agent')) {
    console.log(`[AUDIT] Token exchange - User: ${req.body.userId} - Agent: ${req.get('X-AI-Agent-ID')}`);
  }
  
  next();
};
```

## 9. Testing the Implementation

### 9.1 Test Scenarios

1. **User Login Flow**: Test with email, Google, and Microsoft
2. **Token Storage**: Verify tokens are stored in Token Vault
3. **AI Agent Access**: Test temporary token generation and usage
4. **Token Revocation**: Verify tokens are properly revoked
5. **Error Handling**: Test failure scenarios

### 9.2 Sample Test Script

```typescript
// tests/tokenVault.test.ts
import axios from 'axios';

describe('Token Vault Integration', () => {
  const BASE_URL = 'http://localhost:3001';
  
  test('AI agent should request temporary token', async () => {
    const response = await axios.post(`${BASE_URL}/api/ai-agent/request-token`, {
      userId: 'test-user-id',
      requestedScopes: ['read:voter_data']
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-AI-Agent-ID': 'test-agent'
      }
    });

    expect(response.status).toBe(200);
    expect(response.data.access_token).toBeDefined();
    expect(response.data.expires_in).toBe(3600);
  });

  test('AI agent should revoke token after use', async () => {
    const response = await axios.post(`${BASE_URL}/api/ai-agent/revoke-token`, {
      userId: 'test-user-id'
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-AI-Agent-ID': 'test-agent'
      }
    });

    expect(response.status).toBe(200);
    expect(response.data.message).toBe('Token revoked successfully');
  });
});
```

## 10. Deployment Considerations

### 10.1 Production Environment

1. **Environment variables**: Use secure secret management
2. **HTTPS**: Enforce SSL/TLS everywhere
3. **Rate limiting**: Implement API rate limiting
4. **Monitoring**: Set up logging and monitoring
5. **Backup**: Regular backups of verification data

### 10.2 Scaling

1. **Load balancing**: Use load balancers for backend
2. **Caching**: Implement Redis for session storage
3. **Database**: Use managed database services
4. **CDN**: Use CDN for frontend assets

This implementation provides a complete, secure system for managing voter identity verification using Auth0 Token Vault, ensuring that AI agents never have direct access to user credentials while maintaining the highest security standards.
