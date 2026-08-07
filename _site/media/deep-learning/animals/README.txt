Small 4-class animal image dataset for teaching examples
=========================================================

604 RGB JPEG images, 128x128 pixels (square center-crop, Lanczos resize),
built 2026-08-06:

  cat/      150 images  (class 1 in the course notes)
  dog/      150 images  (class 2)
  chicken/  150 images  (class 3, "baby chick" in the lecture)
  other/    154 images  (class 0: 22 each of butterfly, cow, elephant,
                         horse, sheep, spider, squirrel; the source
                         class is in each filename)

Sources and licenses
--------------------
cat/ and dog/ are subsampled from the Oxford-IIIT Pet Dataset
(O. M. Parkhi, A. Vedaldi, A. Zisserman, C. V. Jawahar, "Cats and
Dogs", CVPR 2012), spread across the 37 breeds, via the Hugging Face
mirror https://huggingface.co/datasets/timm/oxford-iiit-pet
(license CC BY-SA 4.0).

chicken/ and other/ are subsampled from the Animals-10 dataset as
republished and re-annotated by Rapidata,
https://huggingface.co/datasets/Rapidata/Animals-10 (license GPL-2.0);
the images originate from the Kaggle "Animals-10" dataset by Corrado
Alessio and were cross-validated by Rapidata's human annotators.
