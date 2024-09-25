// script.js
document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('form');
    
    form.addEventListener('submit', function(event) {
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const message = document.getElementById('message').value;

        // Simple validation to check if fields are empty
        if (!name || !email || !message) {
            alert('All fields are required!');
            event.preventDefault(); // Prevent form submission
        }
    });
});
