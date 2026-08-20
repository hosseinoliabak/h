CARLA self-driving car frames and their per-pixel segmentation masks
====================================================================

1060 matched pairs of 640 x 480 PNG images, in two folders whose filenames
correspond one to one:

  data/CameraRGB/    the camera frame, RGBA (the alpha channel is opaque)
  data/CameraMask/   the label mask for the frame of the same name, RGBA

Total 526 MB.

The mask is not a picture. Channel 0 of every mask pixel holds a class
index, channels 1 and 2 are zero, and the alpha channel is 255 everywhere.
Opened in an image viewer a mask looks almost black, because the largest
index in use is 22 out of a possible 255. That is expected. The lab reads
the class index with

  mask = tf.io.read_file(mask_path)
  mask = tf.image.decode_png(mask, channels=3)   # drops alpha
  mask = tf.math.reduce_max(mask, axis=-1, keepdims=True)

where the reduce_max picks channel 0 out, since the other two are zero.

Classes
-------
The indices are CARLA 0.9.11 semantic tags, 0 to 22, which is where the
lab's n_classes=23 comes from:

   0 Unlabeled     6 RoadLine     12 TrafficSign   18 TrafficLight
   1 Building      7 Road         13 Sky           19 Static
   2 Fence         8 SideWalk     14 Ground        20 Dynamic
   3 Other         9 Vegetation   15 Bridge        21 Water
   4 Pedestrian   10 Vehicles     16 RailTrack     22 Terrain
   5 Pole         11 Wall         17 GuardRail

Verified against https://carla.readthedocs.io/en/0.9.11/ref_sensors/. The
tag numbering changed in CARLA 0.9.12, so the table in the current docs does
NOT apply to these masks.

Index 0 (Unlabeled) never occurs. Every other index does. Share of all
pixels across the 1060 masks, measured from the files themselves:

   7 Road         43.402 %      17 GuardRail    1.028 %
  13 Sky          32.173 %      10 Vehicles     0.568 %
   1 Building      7.421 %       5 Pole         0.404 %
   9 Vegetation    6.395 %       2 Fence        0.358 %
  22 Terrain       2.794 %      19 Static       0.258 %
   8 SideWalk      1.899 %      15 Bridge       0.175 %
   6 RoadLine      1.507 %      14 Ground       0.101 %
  11 Wall          1.216 %      16 RailTrack    0.085 %
                                20 Dynamic      0.072 %
                                 3 Other        0.052 %
                                 4 Pedestrian   0.042 %
                                18 TrafficLight 0.036 %
                                12 TrafficSign  0.012 %
                                21 Water        0.003 %

Two classes carry three quarters of the pixels between them, which is why a
model that has learned only "sky above, road below" already scores about 75
percent pixel accuracy. The lab page says so where it reads the accuracy
curve.

Hosting
-------
526 MB is far too large to ship with the site, so this folder is kept
locally for rendering only and its copy under _site/ is excluded from the
repository, exactly as the alpaca dataset of the MobileNetV2 lab is.
Readers download the two folders from Google Drive instead, and the lab page
links them.

Nothing was resized, re-encoded, or renamed. The lab resizes to 96 x 128 at
load time, inside the tf.data pipeline.

Source
------
The dataset ships with the "Image Segmentation with U-Net" programming
assignment of the DeepLearning.AI Convolutional Neural Networks course
(Course 4 of the Deep Learning Specialization), where it sits in a folder
named data/ next to the notebook. The frames are rendered by the CARLA
driving simulator (Dosovitskiy, Ros, Codevilla, Lopez, & Koltun, 2017), so
the masks are simulator output rather than human annotation, which is why
they are exact to the pixel along every object boundary.
