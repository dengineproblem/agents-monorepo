import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

const OAuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing');
  const [message, setMessage] = useState('Processing OAuth callback...');

  useEffect(() => {
    const handleOAuthCallback = async () => {
      try {
        // Get URL parameters
        const authCode = searchParams.get('auth_code');
        const code = searchParams.get('code');
        const state = searchParams.get('state');
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');

        // Check for OAuth errors
        if (error) {
          console.error('OAuth error:', error, errorDescription);
          const errorMsg = errorDescription || error;
          setStatus('error');
          setMessage(`OAuth failed: ${errorMsg}`);
          toast.error(`Authentication failed: ${errorMsg}`);
          
          // Redirect to profile after 3 seconds
          setTimeout(() => navigate('/profile'), 3000);
          return;
        }

        // Determine which OAuth flow this is
        const actualCode = authCode || code;
        
        if (!actualCode) {
          console.error('No authorization code received');
          setStatus('error');
          setMessage('No authorization code received');
          toast.error('OAuth callback missing authorization code');
          setTimeout(() => navigate('/profile'), 3000);
          return;
        }

        // Check if this is TikTok (has auth_code parameter)
        if (authCode && state) {
          await handleTikTokCallback(authCode, state);
        } else {
          // Unknown OAuth flow
          console.warn('Unknown OAuth callback', { code: actualCode, state });
          setStatus('error');
          setMessage('Unknown OAuth provider');
          toast.error('Unknown OAuth provider');
          setTimeout(() => navigate('/profile'), 3000);
        }

      } catch (error) {
        console.error('Error in OAuth callback:', error);
        setStatus('error');
        setMessage('An error occurred during authentication');
        toast.error('OAuth callback failed');
        setTimeout(() => navigate('/profile'), 3000);
      }
    };

    handleOAuthCallback();
  }, [searchParams, navigate]);

  const handleTikTokCallback = async (authCode: string, state: string) => {
    try {
      setMessage('Connecting TikTok...');
      console.log('Processing TikTok OAuth callback');

      // Decode state to get user_id
      let userId = '';
      try {
        const decodedState = JSON.parse(atob(decodeURIComponent(state)));
        userId = decodedState.user_id || decodedState.uid;
        console.log('Decoded state:', { userId });
      } catch (e) {
        console.error('Failed to decode state:', e);
        throw new Error('Invalid state parameter');
      }

      if (!userId) {
        throw new Error('No user_id in state');
      }

      // Call backend to exchange code for token
      const API_URL = 'https://performanteaiagency.com/api';
      console.log('Calling TikTok OAuth exchange endpoint');

      const response = await fetch(`${API_URL}/tiktok/oauth/exchange`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
          auth_code: authCode,
          state 
        }),
      });

      const data = await response.json();
      console.log('TikTok OAuth response:', { 
        success: data.success, 
        hasToken: !!data.access_token,
        hasBusinessId: !!data.business_id
      });

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to connect TikTok');
      }

      // Update localStorage with TikTok data
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          const userData = JSON.parse(storedUser);
          userData.tiktok_access_token = data.access_token;
          userData.tiktok_business_id = data.business_id;
          userData.tiktok_account_id = data.account_id;
          localStorage.setItem('user', JSON.stringify(userData));
          console.log('Updated localStorage with TikTok credentials');
        } catch (e) {
          console.error('Failed to update localStorage:', e);
        }
      }

      setStatus('success');
      setMessage('TikTok connected successfully!');
      toast.success('TikTok connected successfully!');
      
      console.log('TikTok OAuth completed, redirecting to profile');
      
      // Redirect to profile after 1 second
      setTimeout(() => navigate('/profile'), 1000);

    } catch (error: any) {
      console.error('TikTok OAuth error:', error);
      setStatus('error');
      setMessage(error.message || 'Failed to connect TikTok');
      toast.error(error.message || 'Failed to connect TikTok');
      setTimeout(() => navigate('/profile'), 3000);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md mx-auto p-8">
        {status === 'processing' && (
          <>
            <div className="mb-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            </div>
            <h2 className="text-xl font-semibold mb-2 text-gray-900">{message}</h2>
            <p className="text-gray-600">Please wait...</p>
          </>
        )}
        
        {status === 'success' && (
          <>
            <div className="mb-4">
              <div className="rounded-full h-12 w-12 bg-green-100 flex items-center justify-center mx-auto">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-semibold mb-2 text-gray-900">{message}</h2>
            <p className="text-gray-600">Redirecting...</p>
          </>
        )}
        
        {status === 'error' && (
          <>
            <div className="mb-4">
              <div className="rounded-full h-12 w-12 bg-red-100 flex items-center justify-center mx-auto">
                <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
            <h2 className="text-xl font-semibold mb-2 text-gray-900">Authentication Failed</h2>
            <p className="text-gray-600 mb-4">{message}</p>
            <p className="text-sm text-gray-500">Redirecting to profile...</p>
          </>
        )}
      </div>
    </div>
  );
};

export default OAuthCallback;

