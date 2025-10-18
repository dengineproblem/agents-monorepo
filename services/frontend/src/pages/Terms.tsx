import React from 'react';

export default function Terms() {
  // TODO: Заменить плейсхолдеры на реальные данные:
  // Performante AI - название приложения
  // ИП A-ONE AGENCY - название компании
  // business@performanteaiagency.com - email поддержки
  // performanteaiagency.com - домен приложения
  
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold mb-8">Terms of Service</h1>
        
        <div className="prose prose-slate max-w-none">
          <p className="text-muted-foreground mb-6">
            Last Updated: {new Date().toLocaleDateString('en-US', { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">1. Acceptance of Terms</h2>
            <p className="mb-4">
              Welcome to <strong>Performante AI</strong> (the "Service"), operated by <strong>ИП A-ONE AGENCY</strong> ("we", "us", or "our"). 
              By accessing or using our Service, you agree to be bound by these Terms of Service ("Terms"). 
              If you disagree with any part of these terms, you may not access the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">2. Description of Service</h2>
            <p className="mb-4">
              Performante AI is a Facebook advertising automation platform that provides:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Automated campaign budget optimization</li>
              <li>AI-powered performance analysis and recommendations</li>
              <li>Campaign management and reporting tools</li>
              <li>Creative testing and analytics</li>
              <li>Integration with Facebook Marketing API</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">3. User Accounts and Registration</h2>
            
            <h3 className="text-xl font-semibold mb-3 mt-4">3.1 Account Creation</h3>
            <p className="mb-4">
              To use our Service, you must:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Be at least 18 years old</li>
              <li>Have a valid Facebook Business account</li>
              <li>Provide accurate and complete registration information</li>
              <li>Connect your Facebook account via Facebook Login</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-4">3.2 Account Security</h3>
            <p className="mb-4">
              You are responsible for:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Maintaining the confidentiality of your account credentials</li>
              <li>All activities that occur under your account</li>
              <li>Notifying us immediately of any unauthorized access</li>
              <li>Ensuring your Facebook access tokens remain valid</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">4. User Responsibilities</h2>
            
            <h3 className="text-xl font-semibold mb-3 mt-4">4.1 Compliance with Facebook Policies</h3>
            <p className="mb-4">
              You agree to comply with:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Facebook's Terms of Service</li>
              <li>Facebook Advertising Policies</li>
              <li>Facebook Community Standards</li>
              <li>Facebook Platform Policies</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-4">4.2 Prohibited Activities</h3>
            <p className="mb-2">You agree NOT to:</p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Use the Service for any illegal purposes</li>
              <li>Create campaigns that violate Facebook policies</li>
              <li>Attempt to circumvent Facebook API rate limits</li>
              <li>Share your account with unauthorized persons</li>
              <li>Reverse engineer or copy our Service</li>
              <li>Use automated scripts to access the Service (except our provided tools)</li>
              <li>Interfere with the Service's operation or security</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-4">4.3 Ad Content</h3>
            <p className="mb-4">
              You are solely responsible for:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>The content, accuracy, and legality of your advertisements</li>
              <li>Ensuring ads comply with applicable laws and regulations</li>
              <li>Any claims or complaints arising from your ad campaigns</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">5. Service Usage</h2>
            
            <h3 className="text-xl font-semibold mb-3 mt-4">5.1 Automated Actions</h3>
            <p className="mb-4">
              Our Service may automatically:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Adjust campaign budgets based on performance</li>
              <li>Pause underperforming ads or ad sets</li>
              <li>Duplicate successful campaigns</li>
              <li>Send performance reports</li>
            </ul>
            <p className="mt-4">
              <strong>Important:</strong> You can review and approve/reject automated actions before they execute. 
              We are not responsible for the results of automated optimizations.
            </p>

            <h3 className="text-xl font-semibold mb-3 mt-4">5.2 API Usage Limits</h3>
            <p className="mb-4">
              The Service is subject to:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Facebook API rate limits</li>
              <li>Our internal usage quotas (if applicable)</li>
              <li>Temporary restrictions during high load</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">6. Fees and Payment</h2>
            
            <h3 className="text-xl font-semibold mb-3 mt-4">6.1 Service Fees</h3>
            <p className="mb-4">
              {/* Если есть платные планы, укажите здесь */}
              Access to the Service may require payment of subscription fees. 
              Current pricing is available at https://performanteaiagency.com/pricing
            </p>

            <h3 className="text-xl font-semibold mb-3 mt-4">6.2 Facebook Ad Spend</h3>
            <p className="mb-4">
              <strong>Important:</strong> You are directly responsible for all Facebook advertising costs. 
              Facebook will charge your payment method on file. We do not handle or charge for Facebook ad spend.
            </p>

            <h3 className="text-xl font-semibold mb-3 mt-4">6.3 Refunds</h3>
            <p className="mb-4">
              Service fees are non-refundable except as required by law or at our sole discretion.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">7. Intellectual Property</h2>
            <p className="mb-4">
              The Service, including all content, features, and functionality, is owned by ИП A-ONE AGENCY 
              and is protected by copyright, trademark, and other intellectual property laws.
            </p>
            <p className="mb-4">
              You retain all rights to your advertising content. By using the Service, you grant us 
              a limited license to access and process your content solely to provide the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">8. Disclaimer of Warranties</h2>
            <p className="mb-4">
              <strong>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND.</strong>
            </p>
            <p className="mb-4">
              We do not guarantee:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Improved campaign performance or ROI</li>
              <li>Uninterrupted or error-free service</li>
              <li>Accuracy or reliability of recommendations</li>
              <li>Compatibility with future Facebook API changes</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">9. Limitation of Liability</h2>
            <p className="mb-4">
              <strong>TO THE MAXIMUM EXTENT PERMITTED BY LAW:</strong>
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>We are not liable for any indirect, incidental, or consequential damages</li>
              <li>We are not responsible for loss of profits, revenue, or data</li>
              <li>We are not liable for campaign performance or Facebook ad spend</li>
              <li>Our total liability shall not exceed the fees you paid in the last 3 months</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">10. Indemnification</h2>
            <p className="mb-4">
              You agree to indemnify and hold harmless ИП A-ONE AGENCY from any claims, damages, 
              or expenses arising from:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Your use of the Service</li>
              <li>Your advertising content</li>
              <li>Your violation of these Terms</li>
              <li>Your violation of Facebook policies</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">11. Service Modifications and Termination</h2>
            
            <h3 className="text-xl font-semibold mb-3 mt-4">11.1 By Us</h3>
            <p className="mb-4">
              We reserve the right to:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li>Modify or discontinue the Service at any time</li>
              <li>Suspend or terminate accounts that violate these Terms</li>
              <li>Change pricing with 30 days' notice</li>
            </ul>

            <h3 className="text-xl font-semibold mb-3 mt-4">11.2 By You</h3>
            <p className="mb-4">
              You may terminate your account at any time through Account Settings. 
              Upon termination, your data will be deleted as described in our Privacy Policy.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">12. Third-Party Services</h2>
            <p className="mb-4">
              The Service integrates with third-party services:
            </p>
            <ul className="list-disc ml-6 mb-4 space-y-2">
              <li><strong>Facebook/Meta:</strong> Subject to Facebook's Terms of Service</li>
              <li><strong>Telegram:</strong> For notifications (optional)</li>
              <li><strong>OpenAI:</strong> For AI-powered analysis</li>
            </ul>
            <p className="mt-4">
              We are not responsible for third-party services' availability, policies, or actions.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">13. Privacy</h2>
            <p className="mb-4">
              Your privacy is important to us. Please review our{' '}
              <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a> to 
              understand how we collect, use, and protect your data.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">14. Changes to Terms</h2>
            <p className="mb-4">
              We may update these Terms from time to time. We will notify you of significant changes 
              via email or prominent notice. Continued use after changes constitutes acceptance.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">15. Governing Law</h2>
            <p className="mb-4">
              These Terms are governed by the laws of Kazakhstan, 
              without regard to conflict of law provisions.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">16. Dispute Resolution</h2>
            <p className="mb-4">
              Any disputes shall be resolved through:
            </p>
            <ol className="list-decimal ml-6 mb-4 space-y-2">
              <li>Good faith negotiation</li>
              <li>Mediation (if negotiation fails)</li>
              <li>Arbitration in accordance with [ARBITRATION_RULES]</li>
            </ol>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">17. Severability</h2>
            <p className="mb-4">
              If any provision of these Terms is found to be unenforceable, 
              the remaining provisions will remain in full effect.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold mb-4">18. Contact Information</h2>
            <p className="mb-4">
              For questions about these Terms, contact us:
            </p>
            <div className="bg-muted p-4 rounded-lg">
              <p><strong>Email:</strong> business@performanteaiagency.com</p>
              <p><strong>Company:</strong> ИП A-ONE AGENCY</p>
              <p><strong>Website:</strong> https://performanteaiagency.com</p>
            </div>
          </section>

          <section className="mb-8 border-t pt-6">
            <p className="text-sm text-muted-foreground">
              By using Performante AI, you acknowledge that you have read, understood, 
              and agree to be bound by these Terms of Service.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

