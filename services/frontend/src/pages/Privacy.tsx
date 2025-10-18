import React from 'react';

export default function Privacy() {
  // Информация о компании:
  // APP_NAME: Performante AI
  // COMPANY_NAME: ИП A-ONE AGENCY
  // SUPPORT_EMAIL: business@performanteaiagency.com
  // DOMAIN: performanteaiagency.com
  
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8">Privacy Policy</h1>
        
        <div className="prose prose-slate max-w-none">
          <p className="text-muted-foreground mb-6">
            Last Updated: {new Date().toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Introduction</h2>
            <p className="mb-4">
              Welcome to <strong>Performante AI</strong> (operated by <strong>ИП A-ONE AGENCY</strong>). 
              We respect your privacy and are committed to protecting your personal data. 
              This privacy policy explains how we collect, use, and safeguard your information 
              when you use our Facebook advertising automation platform.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Information We Collect</h2>
            
            <h3 className="text-xl font-semibold mb-3 mt-4">2.1 Data from Facebook API</h3>
            <p className="mb-2">When you connect your Facebook account, we collect:</p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li><strong>Facebook User ID</strong> - to identify your account</li>
              <li><strong>Access Token</strong> - to access Facebook APIs on your behalf</li>
              <li><strong>Ad Account ID(s)</strong> - to manage your advertising accounts</li>
              <li><strong>Facebook Page ID(s)</strong> - if you manage business pages</li>
              <li><strong>Instagram Business Account ID</strong> - if connected to your pages</li>
              <li><strong>Campaign Data</strong> - names, IDs, statuses of campaigns, ad sets, and ads</li>
              <li><strong>Performance Metrics</strong> - impressions, clicks, spend, conversions, CPM, CPC, CTR</li>
              <li><strong>Audience Data</strong> - targeting settings and audience configurations</li>
              <li><strong>Creative Assets</strong> - ad images, videos, and text (metadata only)</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-4">2.2 Account Information</h3>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Username and password (for our platform)</li>
              <li>Email address</li>
              <li>Phone number (if provided)</li>
              <li>Telegram ID (if using Telegram integration)</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-4">2.3 Usage Data</h3>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Actions you take in the platform</li>
              <li>Budget changes and campaign modifications</li>
              <li>Reports generated</li>
              <li>Login history and session data</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. How We Use Your Information</h2>
            <p className="mb-2">We use the collected data exclusively for the following purposes:</p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li><strong>Campaign Management</strong> - Display and manage your advertising campaigns</li>
              <li><strong>Performance Analytics</strong> - Show metrics, trends, and ROI analysis</li>
              <li><strong>Automated Optimization</strong> - AI-powered budget recommendations and alerts</li>
              <li><strong>Reporting</strong> - Generate daily/weekly reports via Telegram or email</li>
              <li><strong>Creative Testing</strong> - A/B testing of ad creatives</li>
              <li><strong>Service Improvement</strong> - Analyze usage patterns to improve our platform</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. Data Storage and Security</h2>
            <p className="mb-4">
              We take data security seriously and implement industry-standard measures to protect your information:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li><strong>Encryption</strong> - All access tokens are encrypted in our database</li>
              <li><strong>Secure Hosting</strong> - Data is stored on secure servers (Supabase/PostgreSQL)</li>
              <li><strong>HTTPS</strong> - All communications are encrypted via SSL/TLS</li>
              <li><strong>Access Control</strong> - Strict access controls and authentication</li>
              <li><strong>Regular Backups</strong> - Automated backups with encryption</li>
            </ul>
            <p className="mt-4">
              <strong>Data Retention:</strong> We retain your data as long as your account is active. 
              Upon account deletion, all personal data is permanently removed within 30 days.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Data Sharing and Third Parties</h2>
            <p className="mb-4">
              <strong>We do NOT sell, rent, or share your data with third parties</strong> except in the following cases:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li><strong>Facebook/Meta</strong> - API calls to manage your campaigns (as authorized by you)</li>
              <li><strong>OpenAI</strong> - Anonymous campaign data for AI analysis (no personal identifiers)</li>
              <li><strong>Supabase</strong> - Our database hosting provider (with encryption)</li>
              <li><strong>Telegram</strong> - If you enable Telegram reports (only report content)</li>
              <li><strong>Legal Requirements</strong> - If required by law or to protect our legal rights</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Facebook Permissions</h2>
            <p className="mb-2">Our app requests the following Facebook permissions:</p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li><strong>ads_read</strong> - To read your campaign performance data</li>
              <li><strong>ads_management</strong> - To modify budgets, pause/resume campaigns on your behalf</li>
              <li><strong>business_management</strong> - To access your Business Manager assets</li>
              <li><strong>pages_show_list</strong> - To display your Facebook Pages</li>
              <li><strong>instagram_basic</strong> - To access Instagram account info (if connected)</li>
            </ul>
            <p className="mt-4">
              You can revoke these permissions at any time through Facebook Settings → 
              Apps and Websites, or through our platform's account settings.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Your Rights and Choices</h2>
            <p className="mb-2">You have the following rights regarding your data:</p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li><strong>Access</strong> - Request a copy of your data</li>
              <li><strong>Correction</strong> - Update incorrect or incomplete data</li>
              <li><strong>Deletion</strong> - Request deletion of your account and all data</li>
              <li><strong>Revoke Access</strong> - Disconnect Facebook integration at any time</li>
              <li><strong>Data Portability</strong> - Export your data in a standard format</li>
              <li><strong>Opt-out</strong> - Disable automated actions or reports</li>
            </ul>
            <p className="mt-4">
              To exercise any of these rights, contact us at <strong>business@performanteaiagency.com</strong>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. Data Deletion</h2>
            <p className="mb-4">
              You can request deletion of your data in two ways:
            </p>
            <ol className="list-decimal ml-6 mb-4 space-y-2">
              <li>
                <strong>Through our platform:</strong> Go to Profile → Account Settings → Delete Account
              </li>
              <li>
                <strong>Through Facebook:</strong> Go to Facebook Settings → Apps and Websites → 
                Performante AI → Remove
              </li>
            </ol>
            <p className="mt-4">
              Upon deletion request, we will:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Immediately revoke access to your Facebook data</li>
              <li>Delete all personal information within 30 days</li>
              <li>Retain anonymous usage statistics for service improvement</li>
              <li>Send confirmation email once deletion is complete</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Cookies and Tracking</h2>
            <p className="mb-4">
              We use minimal cookies and tracking technologies:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li><strong>Authentication Cookies</strong> - To keep you logged in</li>
              <li><strong>LocalStorage</strong> - To store session data locally in your browser</li>
              <li><strong>No Third-Party Tracking</strong> - We do not use Google Analytics or similar tools</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">10. Children's Privacy</h2>
            <p>
              Our service is not intended for users under 18 years of age. 
              We do not knowingly collect data from children. If you are a parent and believe 
              your child has provided us with personal information, please contact us.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">11. International Data Transfers</h2>
            <p>
              Your data may be processed in countries outside your residence. 
              We ensure appropriate safeguards are in place to protect your data 
              in accordance with this privacy policy and applicable laws.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">12. Changes to This Policy</h2>
            <p>
              We may update this privacy policy from time to time. We will notify you of 
              significant changes via email or prominent notice on our platform. 
              Continued use of our service after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">13. Contact Us</h2>
            <p className="mb-4">
              If you have questions about this Privacy Policy or want to exercise your rights, contact us:
            </p>
            <div className="bg-muted p-4 rounded-lg">
              <p><strong>Email:</strong> business@performanteaiagency.com</p>
              <p><strong>Company:</strong> ИП A-ONE AGENCY</p>
              <p><strong>Website:</strong> https://performanteaiagency.com</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">14. Compliance</h2>
            <p className="mb-2">
              This privacy policy complies with:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Facebook Platform Policies</li>
              <li>GDPR (General Data Protection Regulation) - EU</li>
              <li>CCPA (California Consumer Privacy Act) - USA</li>
              <li>Other applicable data protection laws</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

