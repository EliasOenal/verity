import numpy as np
import matplotlib.pyplot as plt

# Constants for epochs and days
epochs_per_day = 16
epoch_increments = 80  # Increment value for epochs

# Define the linear cube lifetime function
def cube_lifetime(x, e1=0, e2=960, c1=10, c2=80):
    # Calculate slope (m) and y-intercept (b) of the line
    m = (e2 - e1) / (c2 - c1)
    b = e1 - m * c1
    return m * x + b

# Generate x values for the challenge levels
x_values = np.linspace(10, 80, 500)
challenge_points = np.array([10, 15, 20, 25, 30, 35, 40, 45, 50])

# Generate y values for the cube lifetime function
y_values = cube_lifetime(x_values)
y_values_points = cube_lifetime(challenge_points)

# Create a new figure for the adjusted plot
fig, ax1 = plt.subplots(figsize=(10, 6))

# Plot the cube lifetime function with epochs as the primary focus
ax1.plot(x_values, y_values, label="Cube Lifetime (Epochs)", color='blue')

# Annotate the points with the Y values in epochs
for i, (x, y) in enumerate(zip(challenge_points, y_values_points)):
    ax1.annotate(f"{int(y)}", (x, y), textcoords="offset points", xytext=(0,10), ha='center')
    # Add a marker for each point
    ax1.plot(x, y, 'ro')

# Setting up primary Y axis for epochs with extended range to 960
y_ticks_epochs = np.arange(0, max(y_values) + epoch_increments, epoch_increments)  # Epochs incremented by 80
ax1.set_yticks(y_ticks_epochs)

# Create secondary Y axis for days based on the epoch increments
ax2 = ax1.twinx()
y_ticks_days = y_ticks_epochs / epochs_per_day  # Convert epochs to days for alignment
ax2.set_yticks(y_ticks_days)
ax2.set_yticklabels([f"{int(tick)}d" for tick in y_ticks_days])

# Ensure the secondary Y axis for days starts at 0
ax2.set_ylim(ax1.get_ylim()[0] / epochs_per_day, ax1.get_ylim()[1] / epochs_per_day)

# Add additional X axis markings
additional_x_ticks = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80]
ax1.set_xticks(additional_x_ticks)

# Set labels for axes
ax1.set_xlabel("Challenge Level (Bits)")
ax1.set_ylabel("Cube Lifetime (Epochs)")
ax2.set_ylabel("Cube Lifetime (Days)")

# Title and legend
plt.title("Cube Lifetime Function")
ax1.legend(loc="upper left")

# Show the plot with aligned Y axes and marked points
plt.show()
