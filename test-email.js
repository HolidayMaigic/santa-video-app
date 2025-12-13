require('dotenv').config();
const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

resend.emails.send({
  from: 'onboarding@resend.dev',
  to: 'maradesignt@gmail.com',
  subject: 'Test from Santa App',
  html: '<p>If you see this, email is working</p>'
}).then(result => {
  console.log('Success:', result);
}).catch(err => {
  console.log('Error:', err);
});
