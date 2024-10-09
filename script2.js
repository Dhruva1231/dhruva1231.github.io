alert('working');

// Ensure the DOM is fully loaded before running the script
document.addEventListener('DOMContentLoaded', function () {
    const modelViewer = document.querySelector('.model-container model-viewer');

    // Add hover event listeners
    modelViewer.addEventListener('mouseenter', () => {
        modelViewer.style.transform = 'translateY(-20px)'; // Move up on hover
    });

    modelViewer.addEventListener('mouseleave', () => {
        modelViewer.style.transform = 'translateY(0)'; // Reset position when hover ends
    });
});
