import kagglehub
import os
import shutil

print("Downloading dataset...")
path = kagglehub.dataset_download("mohneesh7/indian-medicine-data")
print("Downloaded to:", path)

# Find the CSV file in the downloaded folder
csv_file = None
for root, dirs, files in os.walk(path):
    for file in files:
        if file.endswith('.csv'):
            csv_file = os.path.join(root, file)
            break

if csv_file:
    print(f"Found CSV at: {csv_file}")
    dest = os.path.join(os.getcwd(), 'medicines.csv')
    shutil.copy2(csv_file, dest)
    print(f"Successfully copied to: {dest}")
else:
    print("Could not find a CSV file in the downloaded dataset.")
