import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

import { API_BASE_URL } from '@/config/api';

const FB_APP_ID = import.meta.env.VITE_FB_APP_ID || '690472653668355';
const FB_REDIRECT_URI = import.meta.env.VITE_FB_REDIRECT_URI || 'https://performanteaiagency.com/profile';
const FB_SCOPE = 'ads_read,ads_management,business_management,pages_show_list,pages_manage_ads,pages_read_engagement';

interface FacebookConnectProps {
  onConnected?: () => void;
}

const FacebookConnect: React.FC<FacebookConnectProps> = ({ onConnected }) => {
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [fbData, setFbData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Check if Facebook is already connected
  useEffect(() => {
    const checkConnection = () => {
      const storedUser = localStorage.getItem('user');
      if (storedUser) {
        try {
          const parsedUser = JSON.parse(storedUser);
          if (parsedUser.access_token && parsedUser.ad_account_id) {
            setIsConnected(true);
            setFbData({
              ad_accounts: parsedUser.ad_accounts || [],
              pages: parsedUser.pages || [],
              facebook_user_id: parsedUser.facebook_user_id,
            });
          }
        } catch (error) {

        }
      }
    };

    checkConnection();
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const fbError = params.get('error');
    const errorReason = params.get('error_reason');
    const errorDescription = params.get('error_description');

    if (fbError) {

      setError(errorDescription || fbError);
      toast.error(`Facebook connection failed: ${errorDescription || fbError}`);
      // Clear URL params
      window.history.replaceState({}, document.title, location.pathname);
      return;
    }

    if (code && !isConnected) {
      handleOAuthCallback(code);
    }
  }, [location.search]);

  const handleOAuthCallback = async (code: string) => {
    setIsLoading(true);
    setError(null);

    try {

      // Get current user from localStorage
      const storedUser = localStorage.getItem('user');
      if (!storedUser) {
        throw new Error('No user session found. Please login first.');
      }

      const currentUser = JSON.parse(storedUser);

      // Exchange code for access token via backend
      const response = await fetch(`${API_BASE_URL}/facebook/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          code,
          username: currentUser.username // Send username to link with existing user
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to connect Facebook account');
      }

      // Check if user has ad accounts and pages
      if (!data.ad_accounts || data.ad_accounts.length === 0) {
        setError('No ad accounts found. Please make sure you have access to at least one Facebook Ad Account.');
        toast.error('No ad accounts found');
        setIsLoading(false);
        return;
      }

      if (!data.pages || data.pages.length === 0) {
        setError('No Facebook Pages found. Please create or get access to at least one Facebook Page.');
        toast.error('No Facebook Pages found');
        setIsLoading(false);
        return;
      }

      // Update user data with Facebook info
      const updatedUser = {
        ...currentUser,
        facebook_user_id: data.user.id,
        facebook_name: data.user.name,
        facebook_email: data.user.email,
        access_token: data.access_token,
        ad_account_id: data.ad_accounts[0].id,
        ad_accounts: data.ad_accounts,
        page_id: data.pages[0].id,
        pages: data.pages,
        facebook_connected_at: new Date().toISOString(),
      };

      localStorage.setItem('user', JSON.stringify(updatedUser));

      setIsConnected(true);
      setFbData({
        ad_accounts: data.ad_accounts,
        pages: data.pages,
        facebook_user_id: data.user.id,
      });

      toast.success('Facebook account connected successfully!');

      // Clear URL params
      window.history.replaceState({}, document.title, location.pathname);

      // Call callback if provided
      if (onConnected) {
        onConnected();
      }

      setIsLoading(false);

    } catch (error) {

      const errorMessage = error instanceof Error ? error.message : 'Failed to connect Facebook account';
      setError(errorMessage);
      toast.error(errorMessage);
      setIsLoading(false);
      // Clear URL params on error
      window.history.replaceState({}, document.title, location.pathname);
    }
  };

  const handleConnect = () => {
    setIsLoading(true);
    setError(null);

    // Build Facebook OAuth URL
    const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?` +
      `client_id=${FB_APP_ID}&` +
      `redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}&` +
      `scope=${FB_SCOPE}&` +
      `response_type=code&` +
      `state=${Date.now()}`; // Add state for CSRF protection

    // Redirect to Facebook OAuth
    window.location.href = authUrl;
  };

  const handleDisconnect = () => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      try {
        const currentUser = JSON.parse(storedUser);
        
        // Remove Facebook data but keep user account
        const updatedUser = {
          username: currentUser.username,
          password: currentUser.password,
          phone: currentUser.phone,
          telegram_id: currentUser.telegram_id,
        };

        localStorage.setItem('user', JSON.stringify(updatedUser));
        
        setIsConnected(false);
        setFbData(null);
        toast.success('Facebook account disconnected');
      } catch (error) {

        toast.error('Failed to disconnect Facebook');
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-blue-600 flex items-center justify-center">
              <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            </div>
            <div>
              <CardTitle>Facebook Ads</CardTitle>
              <CardDescription>
                {isConnected ? 'Connected' : 'Not connected'}
              </CardDescription>
            </div>
          </div>
          {isConnected ? (
            <CheckCircle2 className="h-6 w-6 text-green-500" />
          ) : (
            <AlertCircle className="h-6 w-6 text-gray-400" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isConnected && fbData ? (
          <div className="space-y-4">
            <div className="text-sm">
              <p className="text-gray-600 mb-2">Connected accounts:</p>
              <ul className="space-y-1">
                <li className="flex items-center text-green-600">
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {fbData.ad_accounts?.length || 0} Ad Account(s)
                </li>
                <li className="flex items-center text-green-600">
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  {fbData.pages?.length || 0} Facebook Page(s)
                </li>
              </ul>
            </div>

            <Button
              onClick={handleDisconnect}
              variant="outline"
              className="w-full"
            >
              Disconnect Facebook
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Connect your Facebook account to access Ad Accounts and start creating campaigns.
            </p>

            <Button
              onClick={handleConnect}
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <svg className="mr-2 h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                  Connect Facebook Account
                </>
              )}
            </Button>

            <p className="text-xs text-gray-500">
              By connecting, you grant us access to read ad data, manage campaigns, and access your Pages.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FacebookConnect;

