# Store Point of Sale
 Desktop Point of Sale app built with electron
 
  **Features:**

- Can be used by multiple PC's on a network with one central database.
- Receipt Printing.
- Search for product by barcode.
- Staff accounts and permissions. 
- Products and Categories.
- Basic Stock Management.
- Open Tabs (Orders).
- Customer Database. 
- Transaction History. 
- Filter Transactions by Till, Cashier or Status. 
- Filter Transactions by Date Range. 

 **To use on Windows:**
 [Download](http://www.storepointofsale.com/download/v1/StorePOS.msi) the MSI Installer

The default username and password is  **admin**

  **Looking for a Desktop Invoicing app?**
  
 Check out the [Offline Invoicing](https://github.com/tngoman/Offline_Invoicing) app for freelancers.

**To Customize/Create your own installer**

- Clone this project.
- Open terminal and navigate into the cloned folder.
- Run "npm install" to install dependencies.
- Run "npm run electron". 

## Releases

- Release from any working branch with `./release.sh` or `./release.sh 0.1.1`.
- When you omit the version, the script automatically calculates the next patch release from the latest existing `v<version>` tag and updates the package version to match.
- The script updates the version in `package.json` and `package-lock.json`, commits the current branch changes, fast-forward merges into `master`, tags the release as `v<version>`, pushes `master` and the tag, then checks out your original branch again.
- Public releases are published by GitHub Actions to `mnasir786/vape-pos-releases`.
- Add a repository secret named `RELEASES_TOKEN` with permission to create releases in that public repository.
- Normal pushes and pull requests validate the Windows installer build without publishing a release.

![POS](https://github.com/tngoman/Store-POS/blob/master/screenshots/pos.jpg)

![Transactions](https://github.com/tngoman/Store-POS/blob/master/screenshots/transactions.jpg)

![Receipt](https://github.com/tngoman/Store-POS/blob/master/screenshots/receipt.jpg)

![Permissions](https://github.com/tngoman/Store-POS/blob/master/screenshots/permissions.jpg)

![Users](https://github.com/tngoman/Store-POS/blob/master/screenshots/users.jpg)
